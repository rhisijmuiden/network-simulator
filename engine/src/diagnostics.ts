import { shortName } from "./catalog.js";
import { inSubnet, isUsableHost, networkOf, parseIp } from "./ip.js";
import { isHost, isSwitch, isSwitchport, type Device, type Interface, type Topology } from "./model.js";
import { NetworkIndex } from "./network.js";

export interface Finding {
  severity: "error" | "warning" | "info";
  /** Translated in the UI as `diag.<code>` with `params`. */
  code: string;
  device?: string;
  iface?: string;
  params: Record<string, string | number>;
}

/** Static configuration checks: the mistakes that make a lab not work, found without sending a packet. */
export function diagnose(topology: Topology): Finding[] {
  const net = new NetworkIndex(topology);
  const out: Finding[] = [];
  const label = (d: Device, i?: Interface) => (i ? `${d.name} ${shortName(i.name)}` : d.name);

  // Duplicate addresses.
  const owners = new Map<string, string[]>();
  for (const d of topology.devices)
    for (const i of d.interfaces) if (i.ip) owners.set(i.ip.address, [...(owners.get(i.ip.address) ?? []), label(d, i)]);
  for (const [ip, list] of owners) if (list.length > 1) out.push({ severity: "error", code: "duplicateIp", params: { ip, where: list.join(", ") } });

  for (const d of topology.devices) {
    const l3 = net.l3Interfaces(d);
    for (const i of l3) {
      const ip = parseIp(i.ip!.address)!;
      if (!isUsableHost(ip, i.ip!.prefix)) out.push({ severity: "error", code: "notHostAddress", device: d.id, iface: i.id, params: { where: label(d, i), ip: `${i.ip!.address}/${i.ip!.prefix}` } });
    }
    // Overlapping subnets on one routing device.
    for (let a = 0; a < l3.length; a++)
      for (let b = a + 1; b < l3.length; b++) {
        const x = l3[a]!;
        const y = l3[b]!;
        const p = Math.min(x.ip!.prefix, y.ip!.prefix);
        if (networkOf(parseIp(x.ip!.address)!, p) === networkOf(parseIp(y.ip!.address)!, p))
          out.push({ severity: "error", code: "overlap", device: d.id, params: { device: d.name, a: shortName(x.name), b: shortName(y.name) } });
      }

    if (!d.ipRouting && (isHost(d) || isSwitch(d))) {
      const nic = l3.find((i) => i.ip);
      if (nic && d.defaultGateway) {
        const gw = parseIp(d.defaultGateway)!;
        if (!inSubnet(gw, parseIp(nic.ip!.address)!, nic.ip!.prefix))
          out.push({ severity: "error", code: "gatewayOutside", device: d.id, params: { device: d.name, gateway: d.defaultGateway } });
      } else if (nic && isHost(d)) out.push({ severity: "info", code: "noGateway", device: d.id, params: { device: d.name } });
      else if (!nic && isHost(d)) out.push({ severity: "warning", code: "noAddress", device: d.id, params: { device: d.name } });
    }

    for (const i of d.interfaces) {
      for (const acl of [i.aclIn, i.aclOut])
        if (acl && !d.acls.some((a) => a.name === acl)) out.push({ severity: "warning", code: "aclMissing", device: d.id, iface: i.id, params: { where: label(d, i), acl } });
      if (isSwitchport(i) && i.mode === "access" && !net.vlanExists(d, i.accessVlan) && net.peer(i.id))
        out.push({ severity: "error", code: "accessVlanMissing", device: d.id, iface: i.id, params: { where: label(d, i), vlan: i.accessVlan } });
      if (i.type === "svi" && i.ip && net.status(i) === "down")
        out.push({ severity: "warning", code: "sviDown", device: d.id, iface: i.id, params: { where: label(d, i), vlan: i.vlan ?? 1 } });
    }
  }

  for (const l of topology.links) {
    const a = net.ifaces.get(l.a.iface);
    const b = net.ifaces.get(l.b.iface);
    if (!a || !b) continue;
    const la = label(a.device, a.iface);
    const lb = label(b.device, b.iface);
    for (const end of [a, b])
      if (!end.iface.enabled) out.push({ severity: "warning", code: "shutdown", device: end.device.id, iface: end.iface.id, params: { where: label(end.device, end.iface) } });
    const swA = isSwitch(a.device) && isSwitchport(a.iface);
    const swB = isSwitch(b.device) && isSwitchport(b.iface);
    if (swA && swB) {
      if (a.iface.mode !== b.iface.mode) out.push({ severity: "warning", code: "modeMismatch", params: { a: la, b: lb, ma: a.iface.mode, mb: b.iface.mode } });
      else if (a.iface.mode === "trunk" && a.iface.nativeVlan !== b.iface.nativeVlan)
        out.push({ severity: "warning", code: "nativeMismatch", params: { a: la, b: lb, va: a.iface.nativeVlan, vb: b.iface.nativeVlan } });
    }
    if (!swA && !swB && a.iface.ip && b.iface.ip) {
      const ipA = parseIp(a.iface.ip.address)!;
      const ipB = parseIp(b.iface.ip.address)!;
      if (!inSubnet(ipB, ipA, a.iface.ip.prefix) || a.iface.ip.prefix !== b.iface.ip.prefix)
        out.push({ severity: "error", code: "subnetMismatch", params: { a: la, b: lb } });
    }
  }
  return out;
}
