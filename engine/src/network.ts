import { parseIp, parseVlanList } from "./ip.js";
import { isSwitch, isSwitchport, type Device, type Interface, type Link, type Topology } from "./model.js";

export type LinkStatus = "up" | "down" | "admin-down";

export interface IfaceRef {
  device: Device;
  iface: Interface;
}

export interface PeerRef extends IfaceRef {
  link: Link;
}

/**
 * Read-only lookup structure over a topology: interfaces by id, cable peers, interface
 * status and VLAN membership. Rebuilt whenever the topology changes.
 */
export class NetworkIndex {
  readonly devices = new Map<string, Device>();
  readonly ifaces = new Map<string, IfaceRef>();
  private readonly peers = new Map<string, PeerRef>();
  private readonly vlanSets = new Map<string, Set<number> | "all">();
  private readonly statusCache = new Map<string, LinkStatus>();

  constructor(readonly topology: Topology) {
    for (const d of topology.devices) {
      this.devices.set(d.id, d);
      for (const i of d.interfaces) this.ifaces.set(i.id, { device: d, iface: i });
    }
    for (const l of topology.links) {
      const a = this.ifaces.get(l.a.iface);
      const b = this.ifaces.get(l.b.iface);
      if (!a || !b || a.device.id !== l.a.device || b.device.id !== l.b.device) continue;
      this.peers.set(a.iface.id, { ...b, link: l });
      this.peers.set(b.iface.id, { ...a, link: l });
    }
  }

  peer(ifaceId: string): PeerRef | undefined {
    return this.peers.get(ifaceId);
  }

  linkOf(ifaceId: string): Link | undefined {
    return this.peers.get(ifaceId)?.link;
  }

  /** Physical / line protocol status as `show ip interface brief` would report it. */
  status(iface: Interface): LinkStatus {
    const cached = this.statusCache.get(iface.id);
    if (cached) return cached;
    const s = this.computeStatus(iface);
    this.statusCache.set(iface.id, s);
    return s;
  }

  isUp(iface: Interface): boolean {
    return this.status(iface) === "up";
  }

  private computeStatus(iface: Interface): LinkStatus {
    if (!iface.enabled) return "admin-down";
    const ref = this.ifaces.get(iface.id);
    if (!ref) return "down";
    switch (iface.type) {
      case "loopback":
        return "up";
      case "ethernet": {
        const p = this.peers.get(iface.id);
        return p && p.iface.enabled ? "up" : "down";
      }
      case "subinterface": {
        const parent = ref.device.interfaces.find((i) => i.id === iface.parent);
        return parent && this.status(parent) === "up" ? "up" : "down";
      }
      case "svi": {
        // Autostate: an SVI is up when its VLAN exists and at least one up switchport carries it.
        const vlan = iface.vlan ?? 0;
        if (!this.vlanExists(ref.device, vlan)) return "down";
        const carried = ref.device.interfaces.some((p) => isSwitchport(p) && this.carriesVlan(ref.device, p, vlan) && this.status(p) === "up");
        return carried ? "up" : "down";
      }
    }
  }

  vlanExists(device: Device, vlan: number): boolean {
    return vlan === 1 || device.vlans.some((v) => v.id === vlan);
  }

  allowedVlans(iface: Interface): Set<number> | "all" {
    let s = this.vlanSets.get(iface.id);
    if (!s) {
      s = parseVlanList(iface.allowedVlans) ?? "all";
      this.vlanSets.set(iface.id, s);
    }
    return s;
  }

  /** Whether a switchport forwards frames of this VLAN. */
  carriesVlan(device: Device, port: Interface, vlan: number): boolean {
    if (!this.vlanExists(device, vlan)) return false;
    if (port.mode === "access") return port.accessVlan === vlan;
    if (port.mode === "trunk") {
      const allowed = this.allowedVlans(port);
      return allowed === "all" || allowed.has(vlan);
    }
    return false;
  }

  /** Interfaces that terminate IP on this device: routed ports, subinterfaces, SVIs, loopbacks. */
  l3Interfaces(device: Device): Interface[] {
    return device.interfaces.filter((i) => i.ip && (i.type !== "ethernet" || i.mode === "routed" || !isSwitch(device)));
  }

  /** True when `ip` is configured on an up interface of the device. */
  isLocalAddress(device: Device, ip: number): Interface | undefined {
    return this.l3Interfaces(device).find((i) => this.isUp(i) && parseIp(i.ip!.address) === ip);
  }

  /**
   * L3 interfaces in the same broadcast domain as `iface` (excluding itself): what an
   * OSPF hello or an ARP broadcast from it would reach. Follows cables, access and trunk
   * ports (802.1Q tags, native VLAN) and SVIs; down ports end the domain.
   */
  segment(iface: Interface): IfaceRef[] {
    const start = this.ifaces.get(iface.id);
    if (!start || !this.isUp(iface)) return [];
    const found = new Map<string, IfaceRef>();
    const seen = new Set<string>();
    // Ports to leave from, with the 802.1Q tag the frame carries (null = untagged).
    const queue: { port: Interface; tag: number | null }[] = [];
    const enterVlan = (d: Device, vlan: number) => {
      const key = `${d.id}/${vlan}`;
      if (seen.has(key) || !this.vlanExists(d, vlan)) return;
      seen.add(key);
      for (const i of d.interfaces) {
        if (i.type === "svi" && i.vlan === vlan && i.ip && this.isUp(i)) found.set(i.id, { device: d, iface: i });
        else if (i.type === "ethernet" && isSwitchport(i) && this.isUp(i) && this.carriesVlan(d, i, vlan))
          queue.push({ port: i, tag: i.mode === "access" || vlan === i.nativeVlan ? null : vlan });
      }
    };
    const { device } = start;
    if (iface.type === "svi" && iface.vlan !== undefined) enterVlan(device, iface.vlan);
    else if (iface.type === "subinterface" && iface.parent) {
      const parent = device.interfaces.find((i) => i.id === iface.parent);
      if (parent && this.isUp(parent)) queue.push({ port: parent, tag: iface.vlan ?? null });
    } else if (iface.type === "ethernet") queue.push({ port: iface, tag: null });
    while (queue.length) {
      const { port, tag } = queue.shift()!;
      const key = `${port.id}/${tag ?? "u"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const peer = this.peers.get(port.id);
      if (!peer || !this.isUp(peer.iface)) continue;
      const d = peer.device;
      const p = peer.iface;
      if (isSwitch(d) && isSwitchport(p)) {
        if (p.mode === "access") {
          if (tag === null) enterVlan(d, p.accessVlan);
        } else enterVlan(d, tag ?? p.nativeVlan);
      } else if (tag === null) {
        if (p.ip) found.set(p.id, { device: d, iface: p });
      } else {
        const sub = d.interfaces.find((i) => i.type === "subinterface" && i.parent === p.id && i.vlan === tag && i.ip && this.isUp(i));
        if (sub) found.set(sub.id, { device: d, iface: sub });
      }
    }
    found.delete(iface.id);
    return [...found.values()];
  }

  /** Find which device owns an address (for labelling traceroute hops). */
  ownerOf(ip: number): IfaceRef | undefined {
    for (const d of this.devices.values()) {
      const i = d.interfaces.find((x) => x.ip && parseIp(x.ip.address) === ip);
      if (i) return { device: d, iface: i };
    }
    return undefined;
  }
}
