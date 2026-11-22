import { createLoopback, createSubinterface, createSvi, newId } from "../catalog.js";
import { formatIp, isUsableHost, maskToPrefix, networkOf, parseIp, parseVlanList } from "../ip.js";
import { isSwitch, isSwitchport, type AclRule, type AddressMatch, type Device, type Interface, type PortMatch, type Topology } from "../model.js";
import type { OperationRun, Simulator } from "../simulator.js";
import { findIface, parseIfName, parseIfRange } from "./ifname.js";
import { complete, helpFor, matchCommand, pattern, type CommandDef } from "./parser.js";
import * as show from "./show.js";
import { cliExtensions, type CliExtension } from "./extensions.js";
import "../protocols/cli.js";

export type IosMode = "user" | "priv" | "config" | "if" | "if-range" | "subif" | "vlan" | "acl-ext" | "acl-std" | "line" | "router";

export interface CliResult {
  output: string[];
  /** Set when the command changed the configuration. */
  topology?: Topology;
  /** A ping or traceroute to animate. */
  run?: OperationRun;
}

export interface Ctx {
  s: IosSession;
  d: Device;
  t: Topology;
  sim: Simulator;
  out: string[];
  dirty: boolean;
  run?: OperationRun;
}

export type { CliExtension } from "./extensions.js";
export { registerCliExtension } from "./extensions.js";
const extensions = cliExtensions() as readonly CliExtension<Ctx>[];

const H: Record<string, string> = {
  enable: "Turn on privileged commands",
  disable: "Turn off privileged commands",
  exit: "Exit from the EXEC / configuration mode",
  end: "Exit from configure mode",
  logout: "Exit from the EXEC",
  configure: "Enter configuration mode",
  terminal: "Configure from the terminal",
  show: "Show running system information",
  "running-config": "Current operating configuration",
  "startup-config": "Contents of startup configuration",
  ip: "IP information",
  interface: "Interface status or configuration",
  interfaces: "Interface status and configuration",
  brief: "Brief summary",
  route: "IP routing table",
  arp: "ARP table",
  "mac": "MAC configuration",
  "address-table": "MAC forwarding table",
  vlan: "VLAN information / Vlan commands",
  "spanning-tree": "Spanning tree topology",
  "access-lists": "List access lists",
  cdp: "CDP information",
  neighbors: "CDP neighbor entries",
  version: "System hardware and software status",
  module: "Show linecard information",
  trunk: "Show interface trunk information",
  ping: "Send echo messages",
  traceroute: "Trace route to destination",
  copy: "Copy from one file to another",
  write: "Write running configuration to memory",
  memory: "Write to NV memory",
  clear: "Reset functions",
  "arp-cache": "Clear the entire ARP cache",
  dynamic: "Dynamic entries",
  hostname: "Set system's network name",
  range: "Interface range command",
  routing: "Enable IP routing",
  "default-gateway": "Specify default gateway (if not routing IP)",
  "access-list": "Named access-list / Add an access list entry",
  extended: "Extended Access List",
  standard: "Standard Access List",
  address: "Set the IP address of an interface",
  shutdown: "Shutdown the selected interface",
  description: "Interface specific description",
  switchport: "Set switching mode characteristics",
  mode: "Set trunking mode of the interface",
  access: "Set access mode characteristics of the interface",
  allowed: "Set allowed VLAN characteristics when interface is in trunking mode",
  native: "Set trunking native characteristics when interface is in trunking mode",
  add: "add VLANs to the current list",
  remove: "remove VLANs from the current list",
  all: "all VLANs",
  none: "no VLANs",
  encapsulation: "Set encapsulation type for an interface",
  dot1q: "IEEE 802.1Q Virtual LAN",
  "access-group": "Specify access control for packets",
  in: "inbound packets",
  out: "outbound packets",
  cost: "Change an interface's spanning tree port path cost",
  portfast: "Enable an interface to move directly to forwarding on link up",
  priority: "Set the bridge priority for the spanning tree",
  name: "Ascii name of the VLAN",
  no: "Negate a command or set its defaults",
  do: "To run exec commands in config mode",
  line: "Configure a terminal line",
  "secret": "Assign the privileged level secret",
  banner: "Define a login banner",
  service: "Modify use of network based services",
  speed: "Configure speed operation",
  duplex: "Configure duplex operation",
  nonegotiate: "Device will not engage in negotiation protocol on this interface",
  remark: "Access list entry comment",
  password: "Set a password",
  login: "Enable password checking",
  local: "Local password checking",
  transport: "Define transport protocols for line",
  input: "Define which protocols to use when connecting to the terminal server",
  "exec-timeout": "Set the EXEC timeout",
  logging: "Modify message logging facilities",
  synchronous: "Synchronized message output",
  privilege: "Change privilege level for line",
  level: "Assign default privilege level for line",
  reload: "Halt and perform a cold restart",
  history: "Display the session command history",
  clock: "Display the system clock",
  length: "Set number of lines on a screen",
  "domain-lookup": "Enable IP Domain Name System hostname translation",
  console: "Primary terminal line",
  vty: "Virtual terminal",
};

const PH: Record<string, string> = {
  addr: "IP address",
  mask: "IP subnet mask",
  net: "Destination prefix",
  hop: "Forwarding router's address",
  ad: "Distance metric for this route",
  target: "Ping destination address or hostname",
  name: "WORD",
  id: "VLAN ID 1-4094",
  if: "Interface name, for example GigabitEthernet0/1",
  rule: "permit | deny ...",
  vlans: "VLAN IDs of the allowed VLANs",
  p: "bridge priority in increments of 4096",
  n: "IP access list number",
  text: "Line of text",
  c: "port path cost",
  tag: "IEEE 802.1Q VLAN ID required",
  gw: "IP address of default gateway",
};

const cmd = (p: string, run: CommandDef<Ctx>["run"], negatable = false): CommandDef<Ctx> => ({ tokens: pattern(p, H, PH), run, negatable });
const noop = () => {};

function err(c: Ctx, msg: string) {
  c.out.push(msg);
}

function currentIfaces(c: Ctx): Interface[] {
  return c.s.ctx.ifaces.map((id) => c.d.interfaces.find((i) => i.id === id)).filter((i): i is Interface => !!i);
}

function forIfaces(c: Ctx, fn: (i: Interface) => void) {
  for (const i of currentIfaces(c)) fn(i);
  c.dirty = true;
}

// ------------------------------------------------------------------ ACL rule parsing

const PORT_NAMES: Record<string, number> = { www: 80, http: 80, ftp: 21, "ftp-data": 20, ssh: 22, telnet: 23, smtp: 25, domain: 53, pop3: 110, https: 443, bootps: 67, bootpc: 68, tftp: 69, snmp: 161, ntp: 123 };

function parseAddr(words: string[]): { m: AddressMatch; used: number } | null {
  const w = words[0]?.toLowerCase();
  if (w === "any") return { m: { address: "0.0.0.0", wildcard: "255.255.255.255" }, used: 1 };
  if (w === "host" && words[1] && parseIp(words[1]) !== null) return { m: { address: words[1], wildcard: "0.0.0.0" }, used: 2 };
  if (w && parseIp(w) !== null) {
    if (words[1] && parseIp(words[1]) !== null) return { m: { address: w, wildcard: words[1] }, used: 2 };
    return { m: { address: w, wildcard: "0.0.0.0" }, used: 1 };
  }
  return null;
}

function portNum(w?: string): number | null {
  if (!w) return null;
  if (/^\d+$/.test(w) && Number(w) <= 65535) return Number(w);
  return PORT_NAMES[w.toLowerCase()] ?? null;
}

function parsePort(words: string[]): { p: PortMatch; used: number } | null {
  const op = words[0]?.toLowerCase();
  if (op === "eq" || op === "neq" || op === "lt" || op === "gt") {
    const n = portNum(words[1]);
    return n === null ? null : { p: { op, from: n }, used: 2 };
  }
  if (op === "range") {
    const a = portNum(words[1]);
    const b = portNum(words[2]);
    return a === null || b === null || b < a ? null : { p: { op: "range", from: a, to: b }, used: 3 };
  }
  return null;
}

/** Parses "permit tcp any host 10.0.0.1 eq www" (extended) or "deny 10.0.0.0 0.0.0.255" (standard). */
export function parseAclRule(text: string, standard: boolean): AclRule | string {
  const w = text.trim().split(/\s+/);
  const action = w.shift()?.toLowerCase();
  if (action !== "permit" && action !== "deny") return "% Invalid input detected: expected permit or deny.";
  const any: AddressMatch = { address: "0.0.0.0", wildcard: "255.255.255.255" };
  if (standard) {
    const src = parseAddr(w);
    if (!src || src.used !== w.length) return "% Invalid source address.";
    return { id: newId("a"), action, protocol: "ip", src: src.m, dst: any };
  }
  const protocol = w.shift()?.toLowerCase();
  if (protocol !== "ip" && protocol !== "icmp" && protocol !== "tcp" && protocol !== "udp") return "% Invalid protocol: use ip, icmp, tcp or udp.";
  const src = parseAddr(w);
  if (!src) return "% Invalid source address.";
  w.splice(0, src.used);
  let srcPort: PortMatch | undefined;
  if (protocol === "tcp" || protocol === "udp") {
    const p = parsePort(w);
    if (p) {
      srcPort = p.p;
      w.splice(0, p.used);
    }
  }
  const dst = parseAddr(w);
  if (!dst) return "% Invalid destination address.";
  w.splice(0, dst.used);
  let dstPort: PortMatch | undefined;
  if (protocol === "tcp" || protocol === "udp") {
    const p = parsePort(w);
    if (p) {
      dstPort = p.p;
      w.splice(0, p.used);
    }
  }
  // Accepted and ignored keywords.
  while (w.length && ["log", "established", "echo", "echo-reply"].includes(w[0]!.toLowerCase())) w.shift();
  if (w.length) return `% Invalid input detected at '${w[0]}'.`;
  return { id: newId("a"), action, protocol, src: src.m, dst: dst.m, srcPort, dstPort };
}

function ensureAcl(d: Device, name: string, type: "standard" | "extended") {
  let a = d.acls.find((x) => x.name === name);
  if (!a) d.acls.push((a = { name, type, rules: [] }));
  return a;
}

// ------------------------------------------------------------------ exec commands

function pingCmd(c: Ctx, target: string) {
  const r = c.sim.ping(c.d.id, target, { count: 5 });
  c.run = r;
  const marks = r.result.replies.map((x) => (x.status === "reply" ? "!" : x.status === "timeout" ? "." : x.status === "ttl-expired" ? "&" : x.code === "admin" ? "A" : "U"));
  const times = r.result.replies.filter((x) => x.time !== undefined).map((x) => x.time!);
  const pct = Math.round((r.result.received / r.result.sent) * 100);
  c.out.push("Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`, marks.join(""));
  c.out.push(
    `Success rate is ${pct} percent (${r.result.received}/${r.result.sent})${times.length ? `, round-trip min/avg/max = ${Math.min(...times)}/${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}/${Math.max(...times)} ms` : ""}`,
  );
}

function traceCmd(c: Ctx, target: string) {
  const r = c.sim.traceroute(c.d.id, target, { maxHops: 15 });
  c.run = r;
  c.out.push("Type escape sequence to abort.", `Tracing the route to ${target}`, "");
  for (const h of r.result.hops) {
    if (h.status === "timeout") c.out.push(`${String(h.ttl).padStart(3)}  *  *  *`);
    else c.out.push(`${String(h.ttl).padStart(3)} ${h.address}${h.status === "unreachable" ? " !H" : ""}`);
  }
}

function showCommands(priv: boolean): CommandDef<Ctx>[] {
  const list: CommandDef<Ctx>[] = [
    cmd("show ip interface brief", (c) => c.out.push(...show.ipInterfaceBrief(c.d, c.sim))),
    cmd("show interfaces", (c) => c.d.interfaces.forEach((i) => c.out.push(...show.showInterface(c.d, i, c.sim)))),
    cmd("show interfaces <iface:if>", (c, a) => {
      const i = findIface(c.d, a.if!);
      if (!i) return err(c, "% Invalid interface type and number");
      c.out.push(...show.showInterface(c.d, i, c.sim));
    }),
    cmd("show interfaces trunk", (c) => c.out.push(...show.interfacesTrunk(c.d, c.sim))),
    cmd("show ip route", (c) => c.out.push(...show.ipRoute(c.d, c.sim))),
    cmd("show arp", (c) => c.out.push(...show.arpTable(c.d, c.sim))),
    cmd("show ip arp", (c) => c.out.push(...show.arpTable(c.d, c.sim))),
    cmd("show mac address-table", (c) => (isSwitch(c.d) ? c.out.push(...show.macTable(c.d, c.sim)) : err(c, "% Not supported on this device"))),
    cmd("show vlan brief", (c) => (isSwitch(c.d) ? c.out.push(...show.vlanBrief(c.d)) : err(c, "% Not supported on this device"))),
    cmd("show vlan", (c) => (isSwitch(c.d) ? c.out.push(...show.vlanBrief(c.d)) : err(c, "% Not supported on this device"))),
    cmd("show spanning-tree", (c) => (isSwitch(c.d) ? c.out.push(...show.spanningTree(c.d, c.sim)) : err(c, "% Not supported on this device"))),
    cmd("show access-lists", (c) => c.out.push(...show.accessLists(c.d))),
    cmd("show ip access-lists", (c) => c.out.push(...show.accessLists(c.d))),
    cmd("show cdp neighbors", (c) => c.out.push(...show.cdpNeighbors(c.d, c.sim))),
    cmd("show version", (c) => c.out.push(...show.version(c.d, c.s.uptime()))),
    cmd("show module", (c) => c.out.push(...show.modules(c.d))),
    cmd("show history", (c) => c.out.push(...c.s.history.slice(-20).map((h) => `  ${h}`))),
    cmd("show clock", (c) => c.out.push(`*${new Date().toUTCString()}`)),
  ];
  if (priv) {
    list.push(
      cmd("show running-config", (c) => c.out.push(...show.runningConfig(c.d))),
      cmd("show startup-config", (c) => c.out.push(...show.runningConfig(c.d).slice(2))),
    );
  }
  return list;
}

function execCommands(priv: boolean): CommandDef<Ctx>[] {
  const list: CommandDef<Ctx>[] = [
    ...showCommands(priv),
    cmd("ping <ip:target>", (c, a) => pingCmd(c, a.target!)),
    cmd("traceroute <ip:target>", (c, a) => traceCmd(c, a.target!)),
    cmd("exit", (c) => (c.s.mode = "user")),
    cmd("logout", (c) => (c.s.mode = "user")),
    cmd("terminal length <num:n:0-512>", noop),
  ];
  if (!priv) list.push(cmd("enable", (c) => (c.s.mode = "priv")));
  else
    list.push(
      cmd("enable", noop),
      cmd("disable", (c) => (c.s.mode = "user")),
      cmd("configure terminal", (c) => {
        c.s.mode = "config";
        c.out.push("Enter configuration commands, one per line.  End with CNTL/Z.");
      }),
      cmd("configure", (c) => {
        c.s.mode = "config";
        c.out.push("Enter configuration commands, one per line.  End with CNTL/Z.");
      }),
      cmd("copy running-config startup-config", (c) => c.out.push("Destination filename [startup-config]? ", "Building configuration...", "[OK]")),
      cmd("write memory", (c) => c.out.push("Building configuration...", "[OK]")),
      cmd("write", (c) => c.out.push("Building configuration...", "[OK]")),
      cmd("clear arp-cache", (c) => c.sim.reset()),
      cmd("clear mac address-table dynamic", (c) => c.sim.reset()),
      cmd("reload", (c) => c.out.push("% Reload is not needed: changes take effect immediately in the simulator.")),
    );
  return list;
}

// ------------------------------------------------------------------ global configuration

function enterInterface(c: Ctx, name: string) {
  const p = parseIfName(name);
  if (!p) return err(c, "% Invalid interface type and number");
  let i = c.d.interfaces.find((x) => x.name.toLowerCase() === p.full.toLowerCase());
  if (!i) {
    // Create logical interfaces on demand, as IOS does.
    if (p.type === "Vlan") {
      if (!isSwitch(c.d)) return err(c, "% Invalid interface type and number");
      const vlan = Number(p.number);
      if (!(vlan >= 1 && vlan <= 4094)) return err(c, "% Invalid VLAN ID");
      i = createSvi(vlan);
    } else if (p.type === "Loopback") {
      i = createLoopback(c.d, Number(p.number));
    } else if (p.number.includes(".")) {
      const [base, sub] = p.number.split(".");
      const parent = c.d.interfaces.find((x) => x.name.toLowerCase() === `${p.type}${base}`.toLowerCase());
      if (!parent || parent.type !== "ethernet" || (isSwitch(c.d) && parent.mode !== "routed")) return err(c, "% Invalid interface type and number");
      i = createSubinterface(c.d, parent.id, Number(sub), undefined);
    } else return err(c, "% Invalid interface type and number");
    c.d.interfaces.push(i);
    c.dirty = true;
  }
  c.s.ctx.ifaces = [i.id];
  c.s.mode = i.type === "subinterface" ? "subif" : "if";
}

function routeArgs(c: Ctx, a: Record<string, string>) {
  const prefix = maskToPrefix(a.mask!)!;
  const net = formatIp(networkOf(parseIp(a.net!)!, prefix));
  const iface = a.if ? findIface(c.d, a.if) : undefined;
  if (a.if && !iface) {
    err(c, "% Invalid interface type and number");
    return null;
  }
  return { network: net, prefix, nextHop: a.hop, iface: iface?.id, distance: a.ad ? Number(a.ad) : 1 };
}

function addRoute(c: Ctx, a: Record<string, string>, negate: boolean) {
  if (!c.d.ipRouting && c.d.kind !== "router") return err(c, "% IP routing is not enabled: use 'ip routing' first (or 'ip default-gateway').");
  const r = routeArgs(c, a);
  if (!r) return;
  const same = (x: (typeof c.d.staticRoutes)[number]) => x.network === r.network && x.prefix === r.prefix && (!a.hop || x.nextHop === r.nextHop) && (!a.if || x.iface === r.iface);
  if (negate) c.d.staticRoutes = c.d.staticRoutes.filter((x) => !same(x));
  else {
    const existing = c.d.staticRoutes.find(same);
    if (existing) existing.distance = r.distance;
    else c.d.staticRoutes.push({ id: newId("r"), ...r });
  }
  c.dirty = true;
}

function configCommands(): CommandDef<Ctx>[] {
  return [
    cmd("hostname <word:name>", (c, a) => {
      c.d.name = a.name!.slice(0, 64);
      c.dirty = true;
    }),
    cmd("interface <iface:if>", (c, a) => enterInterface(c, a.if!)),
    cmd("interface range <line:if>", (c, a) => {
      const list = parseIfRange(c.d, a.if!);
      if (!list) return err(c, "% Invalid interface range");
      c.s.ctx.ifaces = list.map((i) => i.id);
      c.s.mode = "if-range";
    }),
    cmd(
      "vlan <num:id:1-4094>",
      (c, a, negate) => {
        if (!isSwitch(c.d)) return err(c, "% VLANs exist on switches only");
        const id = Number(a.id);
        if (negate) {
          if (id === 1) return err(c, "% Default VLAN 1 may not be deleted.");
          c.d.vlans = c.d.vlans.filter((v) => v.id !== id);
          c.dirty = true;
          return;
        }
        if (!c.d.vlans.some((v) => v.id === id)) {
          c.d.vlans.push({ id, name: `VLAN${String(id).padStart(4, "0")}` });
          c.dirty = true;
        }
        c.s.ctx.vlan = id;
        c.s.mode = "vlan";
      },
      true,
    ),
    cmd(
      "ip routing",
      (c, _a, negate) => {
        if (c.d.kind === "switch") return err(c, "% IP routing is not supported on this switch; use a multilayer switch.");
        c.d.ipRouting = !negate;
        c.dirty = true;
      },
      true,
    ),
    cmd(
      "ip default-gateway <ip:gw>",
      (c, a, negate) => {
        if (negate) delete c.d.defaultGateway;
        else c.d.defaultGateway = a.gw;
        c.dirty = true;
      },
      true,
    ),
    cmd("ip route <ip:net> <mask:mask> <ip:hop>", addRoute, true),
    cmd("ip route <ip:net> <mask:mask> <ip:hop> <num:ad:1-255>", addRoute, true),
    cmd("ip route <ip:net> <mask:mask> <iface:if>", addRoute, true),
    cmd("ip route <ip:net> <mask:mask> <iface:if> <ip:hop>", addRoute, true),
    cmd("ip route <ip:net> <mask:mask> <iface:if> <ip:hop> <num:ad:1-255>", addRoute, true),
    cmd(
      "ip route <ip:net> <mask:mask>",
      (c, a, negate) => {
        if (!negate) return err(c, "% Incomplete command.");
        addRoute(c, a, true);
      },
      true,
    ),
    cmd(
      "ip access-list extended <word:name>",
      (c, a, negate) => {
        if (negate) {
          c.d.acls = c.d.acls.filter((x) => x.name !== a.name);
          c.dirty = true;
          return;
        }
        const acl = c.d.acls.find((x) => x.name === a.name);
        if (!acl) {
          ensureAcl(c.d, a.name!, "extended");
          c.dirty = true;
        }
        c.s.ctx.acl = a.name;
        c.s.mode = "acl-ext";
      },
      true,
    ),
    cmd(
      "ip access-list standard <word:name>",
      (c, a, negate) => {
        if (negate) {
          c.d.acls = c.d.acls.filter((x) => x.name !== a.name);
          c.dirty = true;
          return;
        }
        if (!c.d.acls.some((x) => x.name === a.name)) {
          ensureAcl(c.d, a.name!, "standard");
          c.dirty = true;
        }
        c.s.ctx.acl = a.name;
        c.s.mode = "acl-std";
      },
      true,
    ),
    cmd(
      "access-list <num:n:1-199> <line:rule>",
      (c, a) => {
        const std = Number(a.n) < 100;
        const r = parseAclRule(a.rule!, std);
        if (typeof r === "string") return err(c, r);
        ensureAcl(c.d, a.n!, std ? "standard" : "extended").rules.push(r);
        c.dirty = true;
      },
    ),
    cmd(
      "access-list <num:n:1-199>",
      (c, a, negate) => {
        if (!negate) return err(c, "% Incomplete command.");
        c.d.acls = c.d.acls.filter((x) => x.name !== a.n);
        c.dirty = true;
      },
      true,
    ),
    cmd(
      "spanning-tree vlan <vlans:v> priority <num:p:0-61440>",
      (c, a, negate) => {
        if (!isSwitch(c.d)) return err(c, "% Not supported on this device");
        const p = Number(a.p);
        if (!negate && p % 4096 !== 0) return err(c, "% Bridge Priority must be in increments of 4096.");
        c.d.stp.priority = negate ? 32768 : p;
        c.dirty = true;
      },
      true,
    ),
    cmd(
      "spanning-tree vlan <vlans:v>",
      (c, _a, negate) => {
        if (!isSwitch(c.d)) return err(c, "% Not supported on this device");
        c.d.stp.enabled = !negate;
        c.dirty = true;
      },
      true,
    ),
    cmd("spanning-tree mode <word:mode>", noop),
    cmd("enable secret <line:text>", noop, true),
    cmd("enable password <line:text>", noop, true),
    cmd("banner <line:text>", noop, true),
    cmd("service <line:text>", noop, true),
    cmd("ip domain-lookup", noop, true),
    cmd("ip domain-name <word:name>", noop, true),
    cmd("line console <num:n:0-0>", (c) => (c.s.mode = "line")),
    cmd("line vty <num:n:0-15> <num:m:0-15>", (c) => (c.s.mode = "line")),
    cmd("end", (c) => (c.s.mode = "priv")),
    cmd("exit", (c) => (c.s.mode = "priv")),
  ];
}

// ------------------------------------------------------------------ interface configuration

function setAddress(c: Ctx, i: Interface, addr: string, mask: string) {
  if (isSwitch(c.d) && isSwitchport(i)) return err(c, "% IP addresses may not be configured on L2 links.");
  const prefix = maskToPrefix(mask)!;
  const ip = parseIp(addr)!;
  if (prefix < 31 && !isUsableHost(ip, prefix))
    return err(c, "% Bad mask /" + prefix + " for address " + addr);
  for (const o of c.d.interfaces) {
    if (o === i || !o.ip) continue;
    const p = Math.min(prefix, o.ip.prefix);
    if (networkOf(parseIp(o.ip.address)!, p) === networkOf(ip, p)) return err(c, `% ${formatIp(networkOf(ip, prefix))} overlaps with ${o.name}`);
  }
  i.ip = { address: addr, prefix };
  c.dirty = true;
}

function interfaceCommands(): CommandDef<Ctx>[] {
  const swOnly = (c: Ctx, fn: (i: Interface) => void) => {
    if (!isSwitch(c.d)) return err(c, "% Invalid input detected: switchport commands exist on switches only.");
    forIfaces(c, (i) => {
      if (i.type !== "ethernet") return;
      if (i.mode === "routed") i.mode = "access";
      fn(i);
    });
  };
  return [
    cmd("ip address <ip:addr> <mask:mask>", (c, a) => currentIfaces(c).forEach((i) => setAddress(c, i, a.addr!, a.mask!))),
    cmd(
      "ip address",
      (c, _a, negate) => {
        if (!negate) return err(c, "% Incomplete command.");
        forIfaces(c, (i) => delete i.ip);
      },
      true,
    ),
    cmd("shutdown", (c, _a, negate) => forIfaces(c, (i) => (i.enabled = negate)), true),
    cmd("description <line:text>", (c, a, negate) => forIfaces(c, (i) => (i.description = negate ? "" : a.text!.slice(0, 200))), true),
    cmd(
      "description",
      (c, _a, negate) => {
        if (!negate) return err(c, "% Incomplete command.");
        forIfaces(c, (i) => (i.description = ""));
      },
      true,
    ),
    cmd("switchport mode access", (c) => swOnly(c, (i) => (i.mode = "access"))),
    cmd("switchport mode trunk", (c) => swOnly(c, (i) => (i.mode = "trunk"))),
    cmd("switchport access vlan <num:id:1-4094>", (c, a, negate) => {
      swOnly(c, (i) => (i.accessVlan = negate ? 1 : Number(a.id)));
      if (!negate && !c.d.vlans.some((v) => v.id === Number(a.id)) && Number(a.id) !== 1) {
        // IOS creates the VLAN when an access port is assigned to it.
        c.d.vlans.push({ id: Number(a.id), name: `VLAN${a.id!.padStart(4, "0")}` });
        c.out.push(`% Access VLAN does not exist. Creating vlan ${a.id}`);
      }
    }, true),
    cmd("switchport trunk native vlan <num:id:1-4094>", (c, a, negate) => swOnly(c, (i) => (i.nativeVlan = negate ? 1 : Number(a.id))), true),
    cmd("switchport trunk allowed vlan <vlans:vlans>", (c, a, negate) => swOnly(c, (i) => (i.allowedVlans = negate ? "all" : a.vlans!.toLowerCase())), true),
    cmd("switchport trunk allowed vlan all", (c) => swOnly(c, (i) => (i.allowedVlans = "all"))),
    cmd("switchport trunk allowed vlan add <vlans:vlans>", (c, a) =>
      swOnly(c, (i) => {
        const cur = parseVlanList(i.allowedVlans);
        if (cur === "all" || cur === null) return;
        const add = parseVlanList(a.vlans!);
        if (add === "all") i.allowedVlans = "all";
        else if (add) i.allowedVlans = compress([...cur, ...add]);
      }),
    ),
    cmd("switchport trunk allowed vlan remove <vlans:vlans>", (c, a) =>
      swOnly(c, (i) => {
        const cur = parseVlanList(i.allowedVlans);
        const del = parseVlanList(a.vlans!);
        if (cur === null || del === null || del === "all") return;
        const base = cur === "all" ? Array.from({ length: 4094 }, (_, k) => k + 1) : [...cur];
        i.allowedVlans = compress(base.filter((v) => !del.has(v)));
      }),
    ),
    cmd("switchport trunk encapsulation dot1q", noop),
    cmd("switchport nonegotiate", noop, true),
    cmd(
      "switchport",
      (c, _a, negate) => {
        if (!isSwitch(c.d)) return err(c, "% Invalid input detected: switchport commands exist on switches only.");
        if (negate && c.d.kind !== "l3switch") return err(c, "% Routed ports need a multilayer switch.");
        forIfaces(c, (i) => {
          if (i.type !== "ethernet") return;
          i.mode = negate ? "routed" : "access";
          if (!negate) delete i.ip;
        });
      },
      true,
    ),
    cmd("encapsulation dot1q <num:tag:1-4094>", (c, a) => {
      const i = currentIfaces(c)[0];
      if (!i || i.type !== "subinterface") return err(c, "% Configure encapsulation on a subinterface");
      i.vlan = Number(a.tag);
      c.dirty = true;
    }),
    cmd(
      "ip access-group <word:name> in",
      (c, a, negate) => forIfaces(c, (i) => (negate ? delete i.aclIn : (i.aclIn = a.name))),
      true,
    ),
    cmd(
      "ip access-group <word:name> out",
      (c, a, negate) => forIfaces(c, (i) => (negate ? delete i.aclOut : (i.aclOut = a.name))),
      true,
    ),
    cmd("spanning-tree cost <num:c:1-200000000>", (c, a, negate) => forIfaces(c, (i) => (negate ? delete i.stpCost : (i.stpCost = Number(a.c)))), true),
    cmd("spanning-tree portfast", noop, true),
    cmd("speed <word:name>", noop, true),
    cmd("duplex <word:name>", noop, true),
    cmd("exit", (c) => (c.s.mode = "config")),
    cmd("end", (c) => (c.s.mode = "priv")),
  ];
}

function compress(list: number[]): string {
  const v = [...new Set(list)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let k = 0; k < v.length; k++) {
    let j = k;
    while (j + 1 < v.length && v[j + 1] === v[j]! + 1) j++;
    out.push(j > k ? `${v[k]}-${v[j]}` : String(v[k]));
    k = j;
  }
  return out.join(",") || "none";
}

function vlanCommands(): CommandDef<Ctx>[] {
  return [
    cmd("name <word:name>", (c, a, negate) => {
      const v = c.d.vlans.find((x) => x.id === c.s.ctx.vlan);
      if (!v) return;
      v.name = negate ? `VLAN${String(v.id).padStart(4, "0")}` : a.name!.slice(0, 32);
      c.dirty = true;
    }, true),
    cmd("exit", (c) => (c.s.mode = "config")),
    cmd("end", (c) => (c.s.mode = "priv")),
  ];
}

function aclCommands(standard: boolean): CommandDef<Ctx>[] {
  const acl = (c: Ctx) => c.d.acls.find((a) => a.name === c.s.ctx.acl);
  const add = (c: Ctx, text: string, seq?: number) => {
    const a = acl(c);
    if (!a) return;
    const r = parseAclRule(text, standard);
    if (typeof r === "string") return err(c, r);
    const idx = seq === undefined ? a.rules.length : Math.min(a.rules.length, Math.max(0, Math.ceil(seq / 10) - 1));
    a.rules.splice(idx, 0, r);
    c.dirty = true;
  };
  return [
    cmd("permit <line:rule>", (c, a) => add(c, `permit ${a.rule}`)),
    cmd("deny <line:rule>", (c, a) => add(c, `deny ${a.rule}`)),
    cmd("<num:seq:1-2147483647> <line:rule>", (c, a) => add(c, a.rule!, Number(a.seq))),
    cmd(
      "<num:seq:1-2147483647>",
      (c, a, negate) => {
        if (!negate) return err(c, "% Incomplete command.");
        const x = acl(c);
        if (!x) return;
        const idx = Number(a.seq) / 10 - 1;
        if (Number.isInteger(idx) && x.rules[idx]) {
          x.rules.splice(idx, 1);
          c.dirty = true;
        }
      },
      true,
    ),
    cmd("remark <line:text>", noop, true),
    cmd("exit", (c) => (c.s.mode = "config")),
    cmd("end", (c) => (c.s.mode = "priv")),
  ];
}

function lineCommands(): CommandDef<Ctx>[] {
    // Line settings (passwords, login, transport) are accepted but have no effect in the simulator.
  const accepted = ["password <line:text>", "login", "login local", "transport input <line:text>", "exec-timeout <line:text>", "logging synchronous", "privilege level <num:n:0-15>"];
  return [cmd("exit", (c) => (c.s.mode = "config")), cmd("end", (c) => (c.s.mode = "priv")), ...accepted.map((p) => cmd(p, noop, true))];
}

const COMMANDS: Record<string, CommandDef<Ctx>[]> = {
  user: execCommands(false),
  priv: execCommands(true),
  config: configCommands(),
  if: interfaceCommands(),
  "if-range": interfaceCommands(),
  subif: interfaceCommands(),
  vlan: vlanCommands(),
  "acl-ext": aclCommands(false),
  "acl-std": aclCommands(true),
  line: lineCommands(),
  router: [],
};

const PROMPTS: Record<string, string> = {
  user: ">",
  priv: "#",
  config: "(config)#",
  if: "(config-if)#",
  "if-range": "(config-if-range)#",
  subif: "(config-subif)#",
  vlan: "(config-vlan)#",
  "acl-ext": "(config-ext-nacl)#",
  "acl-std": "(config-std-nacl)#",
  line: "(config-line)#",
};

/**
 * One console session on a router or switch. The device configuration lives in the
 * topology; every configuration command returns an updated topology.
 */
export class IosSession {
  mode: IosMode | string = "user";
  ctx: { ifaces: string[]; vlan?: number; acl?: string; process?: number } = { ifaces: [] };
  history: string[] = [];
  lastLine = "";
  private readonly started = Date.now();

  constructor(readonly deviceId: string) {}

  uptime(): string {
    const m = Math.floor((Date.now() - this.started) / 60000);
    return `${Math.floor(m / 60)} hours, ${m % 60} minutes`;
  }

  prompt(topology: Topology): string {
    const d = topology.devices.find((x) => x.id === this.deviceId);
    const suffix = PROMPTS[this.mode] ?? extensions.map((e) => e.prompt?.(this.mode)).find(Boolean) ?? "(config)#";
    return `${d?.name ?? "?"}${suffix}`;
  }

  private commandsFor(mode: string): CommandDef<Ctx>[] {
    return [...(COMMANDS[mode] ?? []), ...extensions.flatMap((e) => e.commands(mode))];
  }

  private isConfig(mode = this.mode): boolean {
    return mode !== "user" && mode !== "priv";
  }

  execute(input: string, env: { topology: Topology; sim: Simulator }): CliResult {
    const line = input.replace(/\s+$/, "");
    const draft = JSON.parse(JSON.stringify(env.topology)) as Topology;
    const d = draft.devices.find((x) => x.id === this.deviceId);
    if (!d) return { output: ["% Device not found"] };
    const c: Ctx = { s: this, d, t: draft, sim: env.sim, out: [], dirty: false };
    if (!line.trim()) return { output: [] };
    if (line.trim() !== this.history.at(-1)) this.history.push(line.trim());
    if (this.history.length > 100) this.history.shift();
    this.lastLine = line.trim();
    const promptLen = this.prompt(env.topology).length;

    let text = line.trim();
    let negate = false;
    let mode = this.mode;
    if (this.isConfig() && /^do\s+/i.test(text)) {
      text = text.replace(/^do\s+/i, "");
      mode = "priv";
    }
    if (/^no\s+/i.test(text) && mode !== "user" && mode !== "priv") {
      negate = true;
      text = text.replace(/^no\s+/i, "");
    }
    const offset = line.indexOf(text);
    let r = matchCommand(text, this.commandsFor(mode));
    // A global command typed in a sub-mode runs in global configuration and leaves the sub-mode.
    if (!r.ok && this.isConfig(mode) && mode !== "config") {
      const g = matchCommand(text, this.commandsFor("config"));
      if (g.ok) {
        this.mode = "config";
        r = g;
      }
    }
    if (!r.ok) {
      if (r.error === "invalid") c.out.push(`${" ".repeat(promptLen + offset + r.at)}^`, "% Invalid input detected at '^' marker.");
      else if (r.error === "ambiguous") c.out.push(`% Ambiguous command:  "${line.trim()}"`);
      else c.out.push("% Incomplete command.");
      return { output: c.out };
    }
    if (negate && !r.cmd.negatable) {
      c.out.push(`${" ".repeat(promptLen)}^`, "% Invalid input detected at '^' marker.");
      return { output: c.out };
    }
    const before = this.mode;
    r.cmd.run(c, r.args, negate);
    if (mode === "priv" && before !== this.mode && this.isConfig(before)) this.mode = before;
    return { output: c.out, topology: c.dirty ? draft : undefined, run: c.run };
  }

  /** Lines printed for `?` at the end of the input. */
  help(input: string): string[] {
    let text = input.replace(/^\s+/, "");
    let mode = this.mode;
    if (this.isConfig() && /^do\s+/i.test(text)) {
      text = text.replace(/^do\s+/i, "");
      mode = "priv";
    }
    if (/^no\s+/i.test(text) && this.isConfig(mode)) text = text.replace(/^no\s+/i, "");
    const cmds = this.commandsFor(mode).filter((c) => c.tokens.length);
    const list = helpFor(text, cmds);
    if (!list) return ["% Unrecognized command"];
    const extra = !text && this.isConfig(mode) ? [{ word: "do", help: H.do! }, { word: "no", help: H.no! }] : [];
    const all = [...list, ...extra].filter((x, k, arr) => arr.findIndex((y) => y.word === x.word) === k);
    if (/\S$/.test(text) && !text.endsWith(" ")) return [all.map((x) => x.word).join("  ")];
    return all.map((x) => `  ${x.word.padEnd(22)}${x.help}`);
  }

  complete(input: string): string | null {
    let mode = this.mode;
    let prefix = "";
    let text = input;
    const m = /^(\s*(?:do\s+)?(?:no\s+)?)/i.exec(input);
    if (m && m[1]) {
      prefix = m[1];
      text = input.slice(prefix.length);
      if (/do\s/i.test(prefix)) mode = "priv";
    }
    const r = complete(text, this.commandsFor(mode).filter((c) => c.tokens.length));
    return r === null ? null : prefix + r;
  }

  /** Ctrl+Z / end: back to privileged EXEC. */
  end(): void {
    if (this.isConfig()) this.mode = "priv";
  }
}

