import { runFilters } from "./acl.js";
import { formatIp, inSubnet, parseIp } from "./ip.js";
import { isHost, isSwitch, isSwitchport, type Device, type Endpoint, type Interface, type Topology } from "./model.js";
import { NetworkIndex } from "./network.js";
import { BROADCAST_MAC, type ArpPacket, type Frame, type FrameInfo, type Ipv4Packet, type UnreachableCode } from "./packets.js";
import { buildRoutingTables, resolveRoute, type RouteEntry } from "./routing.js";
import { computeStp, type StpBridge, type StpPort } from "./stp.js";
import "./protocols/ospf.js";
import "./protocols/bgp.js";

export type DropReason =
  | "no-link"
  | "iface-down"
  | "no-ip"
  | "stp-blocking"
  | "vlan-not-allowed"
  | "vlan-missing"
  | "vlan-tagged-on-access"
  | "subif-missing"
  | "acl-in"
  | "acl-out"
  | "no-route"
  | "no-gateway"
  | "arp-failed"
  | "ttl-expired"
  | "not-routing"
  | "storm";

export type SimEvent =
  | { t: number; type: "tx"; link: string; from: Endpoint; to: Endpoint; frame: FrameInfo }
  | { t: number; type: "drop"; device: string; iface?: string; reason: DropReason; frame?: FrameInfo; detail?: string }
  | { t: number; type: "deliver"; device: string; iface?: string; frame: FrameInfo }
  | { t: number; type: "storm"; frames: number };

export interface PingReply {
  seq: number;
  status: "reply" | "timeout" | "unreachable" | "ttl-expired";
  from?: string;
  /** Round trip in simulation time units. */
  time?: number;
  code?: UnreachableCode | "ttl";
  reason?: DropReason;
  /** Device where the packet was dropped, when known. */
  at?: string;
}

export interface PingResult {
  op: "ping";
  source: string;
  target: string;
  sent: number;
  received: number;
  replies: PingReply[];
}

export interface TraceHop {
  ttl: number;
  address?: string;
  /** Device name owning the address, when it is in the topology. */
  name?: string;
  status: "hop" | "reached" | "timeout" | "unreachable";
  reason?: DropReason;
  at?: string;
}

export interface TraceResult {
  op: "traceroute";
  source: string;
  target: string;
  reached: boolean;
  hops: TraceHop[];
}

export interface TcpResult {
  op: "tcp";
  source: string;
  target: string;
  port: number;
  status: "open" | "closed" | "filtered" | "unreachable";
  reason?: DropReason;
  at?: string;
}

export type OperationResult = PingResult | TraceResult | TcpResult;

export interface OperationRun<R extends OperationResult = OperationResult> {
  result: R;
  events: SimEvent[];
  /** Simulation time when the operation ended. */
  duration: number;
}

export interface SimOptions {
  /** Time a frame takes to cross a cable. */
  hopTime?: number;
  arpTimeout?: number;
  replyTimeout?: number;
  /** Frames per operation before the run is stopped as a broadcast storm. */
  maxFrames?: number;
}

interface Scheduled {
  t: number;
  seq: number;
  run: () => void;
  kind: "frame" | "timer";
  cancelled?: boolean;
}

interface PendingArp {
  queue: { packet: Ipv4Packet; forwarded: boolean }[];
}

interface DeviceState {
  arp: Map<number, { mac: string; iface: string }>;
  macTable: Map<string, { vlan: number; mac: string; port: string }>;
  pendingArp: Map<string, PendingArp>;
}

type Listener = (device: Device, packet: Ipv4Packet) => void;

const ICMP_ERROR = (p: Ipv4Packet) => p.protocol === "icmp" && (p.icmp?.type === "unreachable" || p.icmp?.type === "time-exceeded");

/**
 * Discrete-event network simulator. Every frame crossing a cable is an event with a time stamp,
 * so the UI can replay an operation as packets moving over the topology. Runtime state
 * (ARP caches, MAC tables) persists between operations until reset() or a new topology.
 */
export class Simulator {
  readonly net: NetworkIndex;
  readonly stp: { ports: Map<string, StpPort>; bridges: Map<string, StpBridge> };
  readonly routes: Map<string, RouteEntry[]>;
  private state = new Map<string, DeviceState>();
  private queue: Scheduled[] = [];
  private now = 0;
  private seq = 0;
  private frameId = 0;
  private flowId = 0;
  private events: SimEvent[] = [];
  private frames = 0;
  private storm = false;
  private listeners = new Map<number, { device: string; fn: Listener }>();
  private lastDrop = new Map<number, { reason: DropReason; device: string }>();
  private readonly opts: Required<SimOptions>;

  constructor(readonly topology: Topology, opts: SimOptions = {}) {
    this.opts = { hopTime: 1, arpTimeout: 20, replyTimeout: 40, maxFrames: 3000, ...opts };
    this.net = new NetworkIndex(topology);
    this.stp = computeStp(this.net);
    this.routes = buildRoutingTables(this.net);
    this.reset();
  }

  /** Clears ARP caches and MAC address tables. */
  reset(): void {
    this.state.clear();
    for (const d of this.topology.devices) this.state.set(d.id, { arp: new Map(), macTable: new Map(), pendingArp: new Map() });
  }

  // ---------------------------------------------------------------- operations

  ping(sourceId: string, target: string, opts: { count?: number; ttl?: number } = {}): OperationRun<PingResult> {
    const count = Math.max(1, Math.min(10, opts.count ?? 4));
    const result: PingResult = { op: "ping", source: sourceId, target, sent: 0, received: 0, replies: [] };
    return this.operation(result, (flow, src, dst) => {
      let seq = 0;
      const next = () => {
        if (seq >= count) return;
        seq++;
        const mySeq = seq;
        const sentAt = this.now;
        result.sent++;
        this.lastDrop.delete(flow);
        let done = false;
        const finish = (r: PingReply) => {
          if (done) return;
          done = true;
          timer.cancelled = true;
          result.replies.push(r);
          if (r.status === "reply") result.received++;
          this.at(this.now + 2, next);
        };
        const timer = this.at(this.now + this.opts.replyTimeout, () => finish({ seq: mySeq, status: "timeout", ...this.takeDrop(flow) }));
        this.listen(flow, src, (_d, p) => {
          if (p.icmp?.type === "echo-reply" && p.icmp.seq === mySeq) finish({ seq: mySeq, status: "reply", from: formatIp(p.src), time: this.now - sentAt });
          else if (p.icmp && "original" in p.icmp && p.icmp.original.icmp?.type === "echo-request" && p.icmp.original.icmp.seq === mySeq)
            finish({
              seq: mySeq,
              status: p.icmp.type === "time-exceeded" ? "ttl-expired" : "unreachable",
              from: formatIp(p.src),
              code: p.icmp.code,
              ...this.takeDrop(flow),
            });
        });
        const err = this.originate(src, { kind: "ipv4", src: 0, dst, ttl: opts.ttl ?? this.defaultTtl(src), flow, protocol: "icmp", icmp: { type: "echo-request", id: flow, seq: mySeq } });
        if (err) finish({ seq: mySeq, status: "unreachable", reason: err, at: src.id });
      };
      next();
    });
  }

  traceroute(sourceId: string, target: string, opts: { maxHops?: number } = {}): OperationRun<TraceResult> {
    const maxHops = Math.max(1, Math.min(30, opts.maxHops ?? 15));
    const result: TraceResult = { op: "traceroute", source: sourceId, target, reached: false, hops: [] };
    return this.operation(result, (flow, src, dst) => {
      let ttl = 0;
      let silent = 0;
      const next = () => {
        if (ttl >= maxHops) return;
        ttl++;
        const myTtl = ttl;
        this.lastDrop.delete(flow);
        let done = false;
        const finish = (h: TraceHop, stop: boolean) => {
          if (done) return;
          done = true;
          timer.cancelled = true;
          result.hops.push(h);
          silent = h.status === "timeout" ? silent + 1 : 0;
          if (!stop && silent < 3) this.at(this.now + 2, next);
        };
        const timer = this.at(this.now + this.opts.replyTimeout, () => finish({ ttl: myTtl, status: "timeout", ...this.takeDrop(flow) }, false));
        this.listen(flow, src, (_d, p) => {
          const label = (ip: number) => ({ address: formatIp(ip), name: this.net.ownerOf(ip)?.device.name });
          if (p.icmp?.type === "echo-reply" && p.icmp.seq === myTtl) {
            result.reached = true;
            finish({ ttl: myTtl, status: "reached", ...label(p.src) }, true);
          } else if (p.icmp && "original" in p.icmp && p.icmp.original.icmp?.type === "echo-request" && p.icmp.original.icmp.seq === myTtl) {
            if (p.icmp.type === "time-exceeded") finish({ ttl: myTtl, status: "hop", ...label(p.src) }, false);
            else finish({ ttl: myTtl, status: "unreachable", ...label(p.src), ...this.takeDrop(flow) }, true);
          }
        });
        const err = this.originate(src, { kind: "ipv4", src: 0, dst, ttl: myTtl, flow, protocol: "icmp", icmp: { type: "echo-request", id: flow, seq: myTtl } });
        if (err) finish({ ttl: myTtl, status: "unreachable", reason: err, at: src.id }, true);
      };
      next();
    });
  }

  /** Opens a TCP connection (SYN) to test ports and ACL rules with L4 matches. */
  tcpConnect(sourceId: string, target: string, port: number): OperationRun<TcpResult> {
    const result: TcpResult = { op: "tcp", source: sourceId, target, port, status: "filtered" };
    return this.operation(result, (flow, src, dst) => {
      let done = false;
      const finish = (status: TcpResult["status"], extra: Partial<TcpResult> = {}) => {
        if (done) return;
        done = true;
        timer.cancelled = true;
        Object.assign(result, { status, ...extra });
      };
      const timer = this.at(this.now + this.opts.replyTimeout, () => finish("filtered", this.takeDrop(flow)));
      const srcPort = 49152 + (flow % 16000);
      this.listen(flow, src, (_d, p) => {
        if (p.tcp?.flags === "syn-ack") finish("open");
        else if (p.tcp?.flags === "rst") finish("closed");
        else if (p.icmp?.type === "unreachable") finish(p.icmp.code === "admin" ? "filtered" : "unreachable", this.takeDrop(flow));
      });
      const err = this.originate(src, { kind: "ipv4", src: 0, dst, ttl: this.defaultTtl(src), flow, protocol: "tcp", tcp: { srcPort, dstPort: port, flags: "syn" } });
      if (err) finish("unreachable", { reason: err, at: src.id });
    });
  }

  private operation<R extends OperationResult>(result: R, start: (flow: number, src: Device, dst: number) => void): OperationRun<R> {
    const src = this.net.devices.get(result.source);
    const dst = parseIp(result.target);
    this.events = [];
    this.queue = [];
    this.now = 0;
    this.frames = 0;
    this.storm = false;
    this.listeners.clear();
    this.lastDrop.clear();
    if (!src || dst === null) throw new Error("invalid operation");
    const flow = ++this.flowId;
    start(flow, src, dst);
    while (this.queue.length) {
      const item = this.queue.shift()!;
      if (item.cancelled) continue;
      this.now = item.t;
      item.run();
      if (this.frames > this.opts.maxFrames && !this.storm) {
        this.storm = true;
        this.events.push({ t: this.now, type: "storm", frames: this.frames });
        // Stop forwarding; let pending timers fire so results are complete.
        this.queue = this.queue.filter((q) => q.kind === "timer");
      }
    }
    this.listeners.clear();
    for (const s of this.state.values()) s.pendingArp.clear();
    return { result, events: this.events, duration: this.now };
  }

  // ---------------------------------------------------------------- inspection

  routingTable(deviceId: string): RouteEntry[] {
    return this.routes.get(deviceId) ?? [];
  }

  arpTable(deviceId: string) {
    const s = this.state.get(deviceId);
    return s ? [...s.arp].map(([ip, e]) => ({ ip: formatIp(ip), mac: e.mac, iface: e.iface })) : [];
  }

  macTable(deviceId: string) {
    const s = this.state.get(deviceId);
    return s ? [...s.macTable.values()].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac)) : [];
  }

  stpPort(ifaceId: string): StpPort | undefined {
    return this.stp.ports.get(ifaceId);
  }

  // ---------------------------------------------------------------- event plumbing

  private at(t: number, run: () => void, kind: Scheduled["kind"] = "timer"): Scheduled {
    const item: Scheduled = { t, seq: ++this.seq, run, kind };
    // Binary insertion keeps the queue ordered by time, then by scheduling order.
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = this.queue[mid]!;
      if (q.t < t || (q.t === t && q.seq < item.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, item);
    return item;
  }

  private listen(flow: number, device: Device, fn: Listener) {
    this.listeners.set(flow, { device: device.id, fn });
  }

  private takeDrop(flow: number): { reason?: DropReason; at?: string } {
    const d = this.lastDrop.get(flow);
    this.lastDrop.delete(flow);
    return d ? { reason: d.reason, at: d.device } : {};
  }

  private drop(device: Device, reason: DropReason, frame?: Frame, iface?: Interface, detail?: string) {
    this.events.push({ t: this.now, type: "drop", device: device.id, iface: iface?.id, reason, frame: frame && this.info(frame), detail });
    const flow = frame?.flow;
    if (flow !== undefined) this.lastDrop.set(flow, { reason, device: device.id });
  }

  private dropPacket(device: Device, reason: DropReason, packet: Ipv4Packet, iface?: Interface, detail?: string) {
    this.drop(device, reason, { id: ++this.frameId, flow: packet.flow, src: "", dst: "", payload: packet }, iface, detail);
  }

  private info(f: Frame): FrameInfo {
    const base = { id: f.id, flow: f.flow, srcMac: f.src, dstMac: f.dst, vlan: f.vlan };
    const p = f.payload;
    if (p.kind === "arp")
      return { ...base, kind: p.op === "request" ? "arp-request" : "arp-reply", srcIp: formatIp(p.senderIp), dstIp: formatIp(p.targetIp) };
    const ip = { srcIp: formatIp(p.src), dstIp: formatIp(p.dst), ttl: p.ttl };
    if (p.icmp) {
      const detail = "seq" in p.icmp ? `seq ${p.icmp.seq}` : p.icmp.code;
      return { ...base, ...ip, kind: p.icmp.type, detail };
    }
    if (p.tcp) return { ...base, ...ip, kind: "tcp", detail: `${p.tcp.flags.toUpperCase()} ${p.tcp.srcPort}→${p.tcp.dstPort}` };
    return { ...base, ...ip, kind: "udp", detail: p.udp ? `${p.udp.srcPort}→${p.udp.dstPort}` : undefined };
  }

  // ---------------------------------------------------------------- layer 1

  private transmit(device: Device, iface: Interface, frame: Frame) {
    const peer = this.net.peer(iface.id);
    if (!peer) return this.drop(device, "no-link", frame, iface);
    if (!this.net.isUp(iface)) return this.drop(device, "iface-down", frame, iface);
    if (this.storm) return;
    const copy: Frame = { ...frame, id: ++this.frameId };
    this.frames++;
    this.events.push({
      t: this.now,
      type: "tx",
      link: peer.link.id,
      from: { device: device.id, iface: iface.id },
      to: { device: peer.device.id, iface: peer.iface.id },
      frame: this.info(copy),
    });
    this.at(this.now + this.opts.hopTime, () => this.receive(peer.device, peer.iface, copy), "frame");
  }

  private receive(device: Device, iface: Interface, frame: Frame) {
    if (this.storm) return;
    if (isSwitch(device) && isSwitchport(iface)) return this.l2Receive(device, iface, frame);
    // Routed port: tagged frames go to the matching subinterface.
    if (frame.vlan !== undefined) {
      const sub = device.interfaces.find((i) => i.type === "subinterface" && i.parent === iface.id && i.vlan === frame.vlan);
      if (!sub) return this.drop(device, "subif-missing", frame, iface, String(frame.vlan));
      return this.l3Receive(device, sub, { ...frame, vlan: undefined });
    }
    // Untagged frames on a port with subinterfaces only: a native-VLAN subinterface could take them.
    this.l3Receive(device, iface, frame);
  }

  // ---------------------------------------------------------------- layer 2

  private l2Receive(device: Device, port: Interface, frame: Frame) {
    const stp = this.stp.ports.get(port.id);
    if (stp?.state === "blocking") return this.drop(device, "stp-blocking", frame, port);
    let vlan: number;
    if (port.mode === "access") {
      if (frame.vlan !== undefined && frame.vlan !== port.accessVlan) return this.drop(device, "vlan-tagged-on-access", frame, port, String(frame.vlan));
      vlan = port.accessVlan;
    } else {
      vlan = frame.vlan ?? port.nativeVlan;
      if (!this.net.carriesVlan(device, port, vlan) && this.net.vlanExists(device, vlan)) return this.drop(device, "vlan-not-allowed", frame, port, String(vlan));
    }
    if (!this.net.vlanExists(device, vlan)) return this.drop(device, "vlan-missing", frame, port, String(vlan));
    const st = this.state.get(device.id)!;
    st.macTable.set(`${vlan}|${frame.src}`, { vlan, mac: frame.src, port: port.id });
    this.l2Forward(device, vlan, { ...frame, vlan: undefined }, port);
  }

  /** Switches a frame inside a VLAN. `ingress` is null when the switch's own SVI sends it. */
  private l2Forward(device: Device, vlan: number, frame: Frame, ingress: Interface | null) {
    const svi = device.interfaces.find((i) => i.type === "svi" && i.vlan === vlan && this.net.isUp(i));
    if (ingress && svi) {
      if (frame.dst === svi.mac) return this.l3Receive(device, svi, frame);
      if (frame.dst === BROADCAST_MAC) this.l3Receive(device, svi, frame);
    }
    const st = this.state.get(device.id)!;
    const known = frame.dst === BROADCAST_MAC ? undefined : st.macTable.get(`${vlan}|${frame.dst}`);
    if (known) {
      if (known.port === ingress?.id) return; // filtered: destination is on the port it came from
      const out = device.interfaces.find((i) => i.id === known.port);
      if (out) return this.l2Egress(device, out, vlan, frame);
    }
    // Flood: broadcast or unknown unicast to every forwarding port in the VLAN.
    for (const p of device.interfaces) {
      if (!isSwitchport(p) || p.id === ingress?.id || !this.net.isUp(p)) continue;
      if (this.stp.ports.get(p.id)?.state === "blocking") continue;
      if (!this.net.carriesVlan(device, p, vlan)) continue;
      this.l2Egress(device, p, vlan, frame);
    }
  }

  private l2Egress(device: Device, port: Interface, vlan: number, frame: Frame) {
    const tag = port.mode === "trunk" && vlan !== port.nativeVlan ? vlan : undefined;
    this.transmit(device, port, { ...frame, vlan: tag });
  }

  // ---------------------------------------------------------------- layer 3

  private defaultTtl(d: Device): number {
    return isHost(d) ? 128 : 255;
  }

  private l3Receive(device: Device, iface: Interface, frame: Frame) {
    if (!iface.ip || !this.net.isUp(iface)) return;
    const myIp = parseIp(iface.ip.address)!;
    if (frame.dst !== iface.mac && frame.dst !== BROADCAST_MAC) return; // not for us
    const p = frame.payload;
    const st = this.state.get(device.id)!;
    if (p.kind === "arp") {
      if (p.targetIp !== myIp) return;
      st.arp.set(p.senderIp, { mac: p.senderMac, iface: iface.id });
      if (p.op === "request") {
        const reply: ArpPacket = { kind: "arp", op: "reply", senderMac: iface.mac, senderIp: myIp, targetMac: p.senderMac, targetIp: p.senderIp };
        this.sendFrame(device, iface, { id: 0, flow: frame.flow, src: iface.mac, dst: p.senderMac, payload: reply });
      } else this.flushArp(device, iface, p.senderIp);
      return;
    }
    // IPv4
    const deny = runFilters({ device, iface, direction: "in", packet: p });
    if (deny) {
      this.drop(device, "acl-in", frame, iface, deny.rule);
      this.icmpError(device, iface, p, "unreachable", "admin");
      return;
    }
    if (this.net.isLocalAddress(device, p.dst)) return this.localDeliver(device, iface, p, frame);
    if (!device.ipRouting) return this.drop(device, "not-routing", frame, iface);
    this.forward(device, iface, p, frame);
  }

  private forward(device: Device, inIface: Interface, p: Ipv4Packet, frame: Frame) {
    const ttl = p.ttl - 1;
    if (ttl <= 0) {
      this.drop(device, "ttl-expired", frame, inIface);
      this.icmpError(device, inIface, p, "time-exceeded", "ttl");
      return;
    }
    const pkt: Ipv4Packet = { ...p, ttl };
    const r = resolveRoute(this.net, device, this.routes.get(device.id) ?? [], pkt.dst);
    if (!r) {
      this.drop(device, "no-route", frame, inIface, formatIp(pkt.dst));
      this.icmpError(device, inIface, p, "unreachable", "net");
      return;
    }
    const deny = runFilters({ device, iface: r.iface, direction: "out", packet: pkt });
    if (deny) {
      this.drop(device, "acl-out", frame, r.iface, deny.rule);
      this.icmpError(device, inIface, p, "unreachable", "admin");
      return;
    }
    this.output(device, r.iface, r.nextHop, pkt, true);
  }

  /** Sends a packet that this device creates. Returns a reason when it cannot leave the device. */
  private originate(device: Device, packet: Ipv4Packet): DropReason | undefined {
    const self = this.net.isLocalAddress(device, packet.dst);
    if (self) {
      // Ping to an own address: answered internally.
      const pkt = { ...packet, src: packet.dst };
      this.at(this.now, () => this.localDeliver(device, self, pkt, null));
      return undefined;
    }
    const table = this.routes.get(device.id) ?? [];
    const r = resolveRoute(this.net, device, table, packet.dst);
    if (!r) {
      const reason: DropReason = !device.ipRouting && !this.net.l3Interfaces(device).some((i) => this.net.isUp(i)) ? "no-ip" : !device.ipRouting ? "no-gateway" : "no-route";
      this.dropPacket(device, reason, packet);
      return reason;
    }
    const src = packet.src || parseIp(r.iface.ip?.address ?? "") || 0;
    this.output(device, r.iface, r.nextHop, { ...packet, src }, false);
    return undefined;
  }

  private output(device: Device, iface: Interface, nextHop: number, packet: Ipv4Packet, forwarded: boolean) {
    if (!this.net.isUp(iface)) return this.dropPacket(device, "iface-down", packet, iface);
    if (!iface.ip) return this.dropPacket(device, "no-ip", packet, iface);
    const st = this.state.get(device.id)!;
    const myIp = parseIp(iface.ip.address)!;
    // Subnet broadcast goes to everyone without ARP.
    const cached = st.arp.get(nextHop);
    if (cached && cached.iface === iface.id) {
      this.sendFrame(device, iface, { id: 0, flow: packet.flow, src: iface.mac, dst: cached.mac, payload: packet });
      return;
    }
    if (!inSubnet(nextHop, myIp, iface.ip.prefix)) return this.dropPacket(device, "arp-failed", packet, iface, formatIp(nextHop));
    const key = `${iface.id}|${nextHop}`;
    const pending = st.pendingArp.get(key);
    if (pending) {
      pending.queue.push({ packet, forwarded });
      return;
    }
    st.pendingArp.set(key, { queue: [{ packet, forwarded }] });
    const req: ArpPacket = { kind: "arp", op: "request", senderMac: iface.mac, senderIp: myIp, targetMac: "00:00:00:00:00:00", targetIp: nextHop };
    this.sendFrame(device, iface, { id: 0, flow: packet.flow, src: iface.mac, dst: BROADCAST_MAC, payload: req });
    const timer = () => {
      const p = st.pendingArp.get(key);
      if (!p) return;
      st.pendingArp.delete(key);
      for (const q of p.queue) this.dropPacket(device, "arp-failed", q.packet, iface, formatIp(nextHop));
    };
    this.at(this.now + this.opts.arpTimeout, timer);
  }

  private flushArp(device: Device, iface: Interface, ip: number) {
    const st = this.state.get(device.id)!;
    const key = `${iface.id}|${ip}`;
    const p = st.pendingArp.get(key);
    if (!p) return;
    st.pendingArp.delete(key);
    const mac = st.arp.get(ip)!.mac;
    for (const q of p.queue) this.sendFrame(device, iface, { id: 0, flow: q.packet.flow, src: iface.mac, dst: mac, payload: q.packet });
  }

  /** Puts a frame on the wire from an L3 interface (routed port, subinterface or SVI). */
  private sendFrame(device: Device, iface: Interface, frame: Frame) {
    if (iface.type === "subinterface") {
      const parent = device.interfaces.find((i) => i.id === iface.parent);
      if (!parent) return this.drop(device, "iface-down", frame, iface);
      return this.transmit(device, parent, { ...frame, vlan: iface.vlan });
    }
    if (iface.type === "svi") return this.l2Forward(device, iface.vlan ?? 1, frame, null);
    if (iface.type === "loopback") return;
    this.transmit(device, iface, frame);
  }

  private localDeliver(device: Device, iface: Interface, p: Ipv4Packet, frame: Frame | null) {
    const f = frame ?? { id: ++this.frameId, flow: p.flow, src: iface.mac, dst: iface.mac, payload: p };
    this.events.push({ t: this.now, type: "deliver", device: device.id, iface: iface.id, frame: this.info(f) });
    const listener = this.listeners.get(p.flow);
    if (listener && listener.device === device.id) listener.fn(device, p);
    const reply = (r: Omit<Ipv4Packet, "kind" | "src" | "dst" | "ttl" | "flow">) =>
      this.originate(device, { kind: "ipv4", src: p.dst, dst: p.src, ttl: this.defaultTtl(device), flow: p.flow, ...r });
    if (p.protocol === "icmp" && p.icmp?.type === "echo-request") {
      reply({ protocol: "icmp", icmp: { type: "echo-reply", id: p.icmp.id, seq: p.icmp.seq } });
    } else if (p.protocol === "tcp" && p.tcp?.flags === "syn") {
      const open = device.listenPorts.includes(p.tcp.dstPort);
      reply({ protocol: "tcp", tcp: { srcPort: p.tcp.dstPort, dstPort: p.tcp.srcPort, flags: open ? "syn-ack" : "rst" } });
    } else if (p.protocol === "udp") {
      this.icmpError(device, iface, p, "unreachable", "port");
    }
  }

  private icmpError(device: Device, iface: Interface, original: Ipv4Packet, type: "unreachable" | "time-exceeded", code: UnreachableCode | "ttl") {
    if (ICMP_ERROR(original)) return; // never answer an error with an error
    const src = iface.ip ? parseIp(iface.ip.address)! : 0;
    this.originate(device, { kind: "ipv4", src, dst: original.src, ttl: this.defaultTtl(device), flow: original.flow, protocol: "icmp", icmp: { type, code, original } });
  }
}
