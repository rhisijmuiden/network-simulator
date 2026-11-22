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

  /** Find which device owns an address (for labelling traceroute hops). */
  ownerOf(ip: number): IfaceRef | undefined {
    for (const d of this.devices.values()) {
      const i = d.interfaces.find((x) => x.ip && parseIp(x.ip.address) === ip);
      if (i) return { device: d, iface: i };
    }
    return undefined;
  }
}
