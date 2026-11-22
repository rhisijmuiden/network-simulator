import { getModel, shortName } from "../catalog.js";
import { formatIp, prefixToMask } from "../ip.js";
import { isSwitch, isSwitchport, type AclRule, type AddressMatch, type Device, type Interface, type PortMatch } from "../model.js";
import { ROUTE_CODES, routingProtocols } from "../routing.js";
import type { Simulator } from "../simulator.js";
import { ciscoMac } from "./ifname.js";

/** Output of `show` commands in the layout of a Cisco-style CLI. All functions return lines. */

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function compressVlans(list: number[]): string {
  const v = [...new Set(list)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] === v[j]! + 1) j++;
    out.push(j > i ? `${v[i]}-${v[j]}` : String(v[i]));
    i = j;
  }
  return out.join(",");
}

const WELL_KNOWN: Record<number, string> = { 21: "ftp", 22: "22", 23: "telnet", 25: "smtp", 53: "domain", 80: "www", 110: "pop3", 443: "443" };

export function formatAddress(m: AddressMatch): string {
  if (m.wildcard === "255.255.255.255") return "any";
  if (m.wildcard === "0.0.0.0") return `host ${m.address}`;
  return `${m.address} ${m.wildcard}`;
}

function formatPort(p?: PortMatch): string {
  if (!p) return "";
  const name = (n: number) => WELL_KNOWN[n] ?? String(n);
  return p.op === "range" ? ` range ${name(p.from)} ${name(p.to ?? p.from)}` : ` ${p.op} ${name(p.from)}`;
}

export function formatRule(r: AclRule, standard: boolean): string {
  if (standard) return `${r.action} ${formatAddress(r.src)}`;
  return `${r.action} ${r.protocol} ${formatAddress(r.src)}${formatPort(r.srcPort)} ${formatAddress(r.dst)}${formatPort(r.dstPort)}`;
}

const isStandard = (name: string, type?: string) => type === "standard" || (/^\d+$/.test(name) && Number(name) < 100);

export function runningConfig(d: Device): string[] {
  const out: string[] = ["Building configuration...", "", "Current configuration:", "!", "! Network Simulator IOS-style configuration", "!", `hostname ${d.name}`, "!"];
  if (d.kind === "l3switch") out.push(d.ipRouting ? "ip routing" : "no ip routing", "!");
  if (d.kind === "router" && !d.ipRouting) out.push("no ip routing", "!");
  if (isSwitch(d)) {
    out.push("spanning-tree mode pvst");
    if (!d.stp.enabled) out.push("no spanning-tree vlan 1-4094");
    else if (d.stp.priority !== 32768) out.push(`spanning-tree vlan 1-4094 priority ${d.stp.priority}`);
    out.push("!");
    for (const v of [...d.vlans].sort((a, b) => a.id - b.id)) {
      if (v.id === 1) continue;
      out.push(`vlan ${v.id}`, ` name ${v.name}`, "!");
    }
  }
  for (const i of d.interfaces) {
    out.push(`interface ${i.name}`);
    if (i.description) out.push(` description ${i.description}`);
    if (i.type === "subinterface" && i.vlan !== undefined) out.push(` encapsulation dot1Q ${i.vlan}`);
    if (isSwitch(d) && i.type === "ethernet") {
      if (i.mode === "routed") out.push(" no switchport");
      else if (i.mode === "access") {
        if (i.accessVlan !== 1) out.push(` switchport access vlan ${i.accessVlan}`);
        out.push(" switchport mode access");
      } else {
        if (i.nativeVlan !== 1) out.push(` switchport trunk native vlan ${i.nativeVlan}`);
        if (i.allowedVlans !== "all") out.push(` switchport trunk allowed vlan ${i.allowedVlans}`);
        out.push(" switchport mode trunk");
      }
      if (i.stpCost) out.push(` spanning-tree cost ${i.stpCost}`);
    }
    if (i.ip) out.push(` ip address ${i.ip.address} ${prefixToMask(i.ip.prefix)}`);
    else if (!isSwitchport(i) || !isSwitch(d)) out.push(" no ip address");
    if (i.aclIn) out.push(` ip access-group ${i.aclIn} in`);
    if (i.aclOut) out.push(` ip access-group ${i.aclOut} out`);
    if (!i.enabled) out.push(" shutdown");
    out.push("!");
  }
  for (const [id, cfg] of Object.entries(d.protocols)) {
    const p = routingProtocols().find((x) => x.id === id);
    const lines = p?.runningConfig?.(cfg);
    if (lines?.length) out.push(...lines, "!");
  }
  if (d.defaultGateway) out.push(`ip default-gateway ${d.defaultGateway}`);
  for (const r of d.staticRoutes) {
    const exit = d.interfaces.find((i) => i.id === r.iface);
    out.push(`ip route ${r.network} ${prefixToMask(r.prefix)}${exit ? ` ${exit.name}` : ""}${r.nextHop ? ` ${r.nextHop}` : ""}${r.distance !== 1 ? ` ${r.distance}` : ""}`);
  }
  if (d.defaultGateway || d.staticRoutes.length) out.push("!");
  for (const a of d.acls) {
    const std = isStandard(a.name, a.type);
    if (/^\d+$/.test(a.name)) for (const r of a.rules) out.push(`access-list ${a.name} ${formatRule(r, std)}`);
    else {
      out.push(`ip access-list ${std ? "standard" : "extended"} ${a.name}`);
      for (const r of a.rules) out.push(` ${formatRule(r, std)}`);
    }
    out.push("!");
  }
  out.push("line con 0", "line vty 0 4", " login", "!", "end");
  return out;
}

function statusText(sim: Simulator, i: Interface): [string, string] {
  const s = sim.net.status(i);
  if (s === "admin-down") return ["administratively down", "down"];
  if (s === "down") return ["down", "down"];
  return ["up", "up"];
}

export function ipInterfaceBrief(d: Device, sim: Simulator): string[] {
  const out = [`${pad("Interface", 27)}${pad("IP-Address", 16)}OK? Method Status                Protocol`];
  for (const i of d.interfaces) {
    const [st, proto] = statusText(sim, i);
    out.push(`${pad(i.name, 27)}${pad(i.ip?.address ?? "unassigned", 16)}YES ${pad(i.ip ? "manual" : "unset", 7)}${pad(st, 22)}${proto}`);
  }
  return out;
}

export function showInterface(d: Device, i: Interface, sim: Simulator): string[] {
  const [st, proto] = statusText(sim, i);
  const out = [`${i.name} is ${st}, line protocol is ${proto}`];
  const hw = i.type === "loopback" ? "Loopback" : i.type === "svi" ? "EtherSVI" : i.speed >= 10000 ? "Ten Gigabit Ethernet" : i.speed >= 1000 ? "Gigabit Ethernet" : "Fast Ethernet";
  out.push(`  Hardware is ${hw}, address is ${ciscoMac(i.mac)} (bia ${ciscoMac(i.mac)})`);
  if (i.description) out.push(`  Description: ${i.description}`);
  if (i.ip) out.push(`  Internet address is ${i.ip.address}/${i.ip.prefix}`);
  out.push(`  MTU 1500 bytes, BW ${i.speed * 1000} Kbit/sec, DLY 10 usec,`);
  if (i.type === "subinterface") out.push(`  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${i.vlan ?? "not set"}.`);
  else out.push("  Encapsulation ARPA, loopback not set");
  if (i.type === "ethernet") {
    const peer = sim.net.peer(i.id);
    out.push(`  Full-duplex, ${i.speed >= 1000 ? `${i.speed / 1000}Gb/s` : `${i.speed}Mb/s`}, media type is ${peer?.link.medium === "fiber" ? "SFP" : "RJ45"}`);
  }
  return out;
}

export function ipRoute(d: Device, sim: Simulator): string[] {
  const codes = { ...ROUTE_CODES, ...Object.fromEntries(routingProtocols().map((p) => [p.id, p.code])) } as Record<string, string>;
  const out = [
    "Codes: L - local, C - connected, S - static, O - OSPF, B - BGP",
    "       IA - OSPF inter area, * - candidate default",
    "",
  ];
  const table = sim.routingTable(d.id);
  const def = table.find((r) => r.prefix === 0 && r.nextHop !== undefined);
  out.push(def ? `Gateway of last resort is ${formatIp(def.nextHop!)} to network 0.0.0.0` : "Gateway of last resort is not set", "");
  const ifn = (id?: string) => d.interfaces.find((i) => i.id === id)?.name ?? "";
  for (const r of table) {
    let code = codes[r.protocol] ?? "?";
    if (r.protocol === "gateway") code = "S*";
    else if (r.prefix === 0) code += "*";
    const net = `${formatIp(r.network)}/${r.prefix}`;
    if (r.protocol === "connected" || r.protocol === "local") out.push(`${pad(code, 9)}${net} is directly connected, ${ifn(r.iface)}`);
    else
      out.push(
        `${pad(code, 9)}${net} [${r.distance}/${r.metric}]${r.nextHop !== undefined ? ` via ${formatIp(r.nextHop)}` : ""}${r.iface && r.nextHop === undefined ? ` is directly connected, ${ifn(r.iface)}` : r.iface ? `, ${ifn(r.iface)}` : ""}`,
      );
  }
  return out;
}

export function arpTable(d: Device, sim: Simulator): string[] {
  const out = ["Protocol  Address          Age (min)  Hardware Addr   Type   Interface"];
  const ifn = (id?: string) => d.interfaces.find((i) => i.id === id)?.name ?? "";
  for (const i of sim.net.l3Interfaces(d)) if (sim.net.isUp(i)) out.push(`Internet  ${pad(i.ip!.address, 17)}${lpad("-", 9)}   ${ciscoMac(i.mac)}  ARPA   ${i.name}`);
  for (const a of sim.arpTable(d.id)) out.push(`Internet  ${pad(a.ip, 17)}${lpad("0", 9)}   ${ciscoMac(a.mac)}  ARPA   ${ifn(a.iface)}`);
  return out;
}

export function macTable(d: Device, sim: Simulator): string[] {
  const rows = sim.macTable(d.id);
  const ifn = (id: string) => shortName(d.interfaces.find((i) => i.id === id)?.name ?? "");
  return [
    "          Mac Address Table",
    "-------------------------------------------",
    "",
    "Vlan    Mac Address       Type        Ports",
    "----    -----------       --------    -----",
    ...rows.map((r) => `${lpad(r.vlan, 4)}    ${ciscoMac(r.mac)}    DYNAMIC     ${ifn(r.port)}`),
    `Total Mac Addresses for this criterion: ${rows.length}`,
  ];
}

export function vlanBrief(d: Device): string[] {
  const out = [
    "VLAN Name                             Status    Ports",
    "---- -------------------------------- --------- -------------------------------",
  ];
  const vlans = [{ id: 1, name: "default" }, ...d.vlans.filter((v) => v.id !== 1)].sort((a, b) => a.id - b.id);
  for (const v of vlans) {
    const ports = d.interfaces.filter((i) => isSwitchport(i) && i.mode === "access" && i.accessVlan === v.id).map((i) => shortName(i.name));
    const chunks: string[] = [];
    for (let k = 0; k < ports.length; k += 4) chunks.push(ports.slice(k, k + 4).join(", "));
    out.push(`${pad(v.id, 5)}${pad(v.name, 33)}${pad("active", 10)}${chunks[0] ?? ""}`);
    for (const c of chunks.slice(1)) out.push(`${" ".repeat(48)}${c}`);
  }
  return out;
}

export function interfacesTrunk(d: Device, sim: Simulator): string[] {
  const trunks = d.interfaces.filter((i) => isSwitchport(i) && i.mode === "trunk" && sim.net.isUp(i));
  if (!trunks.length) return [];
  const allowed = (i: Interface) => (i.allowedVlans === "all" ? "1-4094" : i.allowedVlans);
  const active = (i: Interface) => compressVlans([1, ...d.vlans.map((v) => v.id)].filter((v) => sim.net.carriesVlan(d, i, v)));
  const fwd = (i: Interface) => (sim.stpPort(i.id)?.state === "blocking" ? "none" : active(i));
  return [
    "Port        Mode             Encapsulation  Status        Native vlan",
    ...trunks.map((i) => `${pad(shortName(i.name), 12)}${pad("on", 17)}${pad("802.1q", 15)}${pad("trunking", 14)}${i.nativeVlan}`),
    "",
    "Port        Vlans allowed on trunk",
    ...trunks.map((i) => `${pad(shortName(i.name), 12)}${allowed(i)}`),
    "",
    "Port        Vlans allowed and active in management domain",
    ...trunks.map((i) => `${pad(shortName(i.name), 12)}${active(i)}`),
    "",
    "Port        Vlans in spanning tree forwarding state and not pruned",
    ...trunks.map((i) => `${pad(shortName(i.name), 12)}${fwd(i)}`),
  ];
}

export function spanningTree(d: Device, sim: Simulator): string[] {
  if (!d.stp.enabled) return ["No spanning tree instance exists."];
  const b = sim.stp.bridges.get(d.id);
  const ownMac = ciscoMac(d.interfaces.find((i) => i.type === "ethernet")?.mac ?? "000000000000");
  const out = ["VLAN0001", "  Spanning tree enabled protocol ieee"];
  if (b) {
    const root = sim.net.devices.get(b.root)!;
    const rootMac = ciscoMac(root.interfaces.find((i) => i.type === "ethernet")?.mac ?? "");
    out.push(`  Root ID    Priority    ${root.stp.priority + 1}`, `             Address     ${rootMac}`);
    if (b.root === d.id) out.push("             This bridge is the root");
    else {
      const rp = d.interfaces.find((i) => i.id === b.rootPort);
      out.push(`             Cost        ${b.rootCost}`, `             Port        ${rp ? d.interfaces.indexOf(rp) + 1 : 0} (${rp?.name ?? "-"})`);
    }
  } else out.push(`  Root ID    Priority    ${d.stp.priority + 1}`, `             Address     ${ownMac}`, "             This bridge is the root");
  out.push(
    "",
    `  Bridge ID  Priority    ${d.stp.priority + 1}  (priority ${d.stp.priority} sys-id-ext 1)`,
    `             Address     ${ownMac}`,
    "",
    "Interface           Role Sts Cost      Prio.Nbr Type",
    "------------------- ---- --- --------- -------- --------------------------------",
  );
  const role: Record<string, string> = { root: "Root", designated: "Desg", alternate: "Altn", edge: "Desg", disabled: "Disa" };
  for (const i of d.interfaces) {
    if (!isSwitchport(i) || !sim.net.isUp(i)) continue;
    const p = sim.stpPort(i.id);
    if (!p) continue;
    out.push(`${pad(shortName(i.name), 20)}${pad(role[p.role] ?? p.role, 5)}${pad(p.state === "blocking" ? "BLK" : "FWD", 4)}${pad(p.cost, 10)}${pad(`128.${d.interfaces.indexOf(i) + 1}`, 9)}${p.role === "edge" ? "P2p Edge" : "P2p"}`);
  }
  return out;
}

export function accessLists(d: Device): string[] {
  const out: string[] = [];
  for (const a of d.acls) {
    const std = isStandard(a.name, a.type);
    out.push(`${std ? "Standard" : "Extended"} IP access list ${a.name}`);
    a.rules.forEach((r, n) => out.push(`    ${(n + 1) * 10} ${formatRule(r, std)}`));
  }
  return out;
}

export function cdpNeighbors(d: Device, sim: Simulator): string[] {
  const out = [
    "Capability Codes: R - Router, S - Switch, H - Host",
    "",
    "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID",
  ];
  const cap = (x: Device) => (x.kind === "router" ? "R" : x.kind === "switch" ? "S" : x.kind === "l3switch" ? "R S" : "H");
  for (const i of d.interfaces) {
    const p = sim.net.peer(i.id);
    if (!p || !sim.net.isUp(i)) continue;
    const short = (n: string) => shortName(n).replace(/^([A-Za-z]+)/, "$1 ");
    out.push(`${pad(p.device.name, 17)}${pad(short(i.name), 18)}${pad(150, 11)}${pad(cap(p.device), 12)}${pad(getModel(p.device.model)?.id ?? "", 10)}${short(p.iface.name)}`);
  }
  return out;
}

export function version(d: Device, uptime: string): string[] {
  const m = getModel(d.model);
  return [
    "Network Simulator IOS-style software, Version 1.0",
    "Simulated device: no real operating system image is used.",
    "",
    `${d.name} uptime is ${uptime}`,
    `Platform: ${m?.platform ?? d.model}`,
    "",
    `${d.interfaces.filter((i) => i.type === "ethernet").length} Ethernet interfaces`,
    `Base ethernet MAC address: ${ciscoMac(d.interfaces[0]?.mac ?? "000000000000")}`,
    "",
    "Configuration register is 0x2102",
  ];
}

export function modules(d: Device): string[] {
  const m = getModel(d.model);
  const out = ["Mod Ports Card Type", "--- ----- --------------------------------------------"];
  for (const g of m?.ports ?? []) {
    if (!g.module) continue;
    const slot = g.slots[0]!.split("/")[0]!;
    out.push(`${lpad(slot, 3)} ${lpad(g.slots.length, 5)} ${g.module}`);
  }
  if (out.length === 2) out.push("  0     0 Fixed configuration, no modules");
  return out;
}

