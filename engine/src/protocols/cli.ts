import { formatIp, networkOf, parseIp, prefixToMask } from "../ip.js";
import type { Device } from "../model.js";
import { findIface } from "../cli/ifname.js";
import { registerCliExtension } from "../cli/extensions.js";
import { pattern, type CommandDef } from "../cli/parser.js";
import type { Ctx } from "../cli/ios.js";
import { ipRoute } from "../cli/show.js";
import { shortName } from "../catalog.js";
import { BGP, bgpConfig, bgpState, formatPath, nextHopText, type BgpConfig } from "./bgp.js";
import { autoRouterId, OSPF, ospfConfig, ospfInterfaces, ospfNeighbors, routerId, type OspfConfig } from "./ospf.js";

/** IOS commands for OSPF and BGP: `router ospf`, `router bgp`, `ip ospf cost` and their show commands. */

const H: Record<string, string> = {
  router: "Enable a routing process",
  ospf: "Open Shortest Path First (OSPF)",
  bgp: "Border Gateway Protocol (BGP)",
  network: "Enable routing on an IP network",
  area: "Set the OSPF area ID",
  "router-id": "router-id for this OSPF process",
  "passive-interface": "Suppress routing updates on an interface",
  "default-information": "Control distribution of default information",
  originate: "Distribute a default route",
  "log-adjacency-changes": "Log changes in adjacency state",
  "auto-cost": "Calculate OSPF interface cost according to bandwidth",
  "reference-bandwidth": "Use reference bandwidth method to assign OSPF cost",
  neighbor: "Specify a neighbor router / Neighbor list",
  "remote-as": "Specify a BGP neighbor",
  "next-hop-self": "Disable the next hop calculation for this neighbor",
  description: "Neighbor specific description",
  mask: "Network mask",
  "log-neighbor-changes": "Log neighbor up/down and reset reason",
  ip: "IP information",
  cost: "Interface cost",
  show: "Show running system information",
  route: "IP routing table",
  interface: "Interface information",
  brief: "Brief summary",
  summary: "Summary of BGP neighbor status",
  protocols: "IP routing protocol process parameters and statistics",
  exit: "Exit from routing protocol configuration mode",
  end: "Exit from configure mode",
};

const PH: Record<string, string> = {
  pid: "Process ID",
  asn: "Autonomous system number",
  addr: "Network number / neighbor address",
  wc: "OSPF wild card bits",
  area: "OSPF area ID as a decimal value",
  id: "Router ID in IP address format",
  if: "Interface name",
  as: "AS of remote neighbor",
  net: "Network number",
  mask: "Network mask",
  c: "Cost",
  text: "Up to 80 characters describing this neighbor",
  n: "Reference bandwidth in Mbits per second",
};

const cmd = (p: string, run: CommandDef<Ctx>["run"], negatable = false): CommandDef<Ctx> => ({ tokens: pattern(p, H, PH), run, negatable });
const noop = () => {};
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function ospfOf(d: Device): OspfConfig | undefined {
  return ospfConfig(d);
}

function saveOspf(c: Ctx, cfg: OspfConfig) {
  c.d.protocols[OSPF] = cfg;
  c.dirty = true;
}

function saveBgp(c: Ctx, cfg: BgpConfig) {
  c.d.protocols[BGP] = cfg;
  c.dirty = true;
}

function canRoute(c: Ctx): boolean {
  if (c.d.kind !== "router" && c.d.kind !== "l3switch") {
    c.out.push("% Routing protocols need a router or a multilayer switch.");
    return false;
  }
  if (!c.d.ipRouting) {
    c.out.push("% IP routing not enabled");
    return false;
  }
  return true;
}

/** Classful mask for `network 10.0.0.0` without `mask`. */
function classfulPrefix(ip: number): number {
  const first = ip >>> 24;
  return first < 128 ? 8 : first < 192 ? 16 : 24;
}

const config: CommandDef<Ctx>[] = [
  cmd(
    "router ospf <num:pid:1-65535>",
    (c, a, negate) => {
      const pid = Number(a.pid);
      const cur = ospfOf(c.d);
      if (negate) {
        if (cur && cur.processId === pid) {
          delete c.d.protocols[OSPF];
          c.dirty = true;
        }
        return;
      }
      if (!canRoute(c)) return;
      if (cur && cur.processId !== pid) return void c.out.push(`% Only one OSPF process is supported in the simulator (process ${cur.processId} is running).`);
      if (!cur) saveOspf(c, { processId: pid, networks: [], passive: [], costs: {} });
      c.s.ctx.process = pid;
      c.s.mode = "router-ospf";
    },
    true,
  ),
  cmd(
    "router bgp <num:asn:1-4294967295>",
    (c, a, negate) => {
      const asn = Number(a.asn);
      const cur = bgpConfig(c.d);
      if (negate) {
        if (cur && cur.asn === asn) {
          delete c.d.protocols[BGP];
          c.dirty = true;
        }
        return;
      }
      if (!canRoute(c)) return;
      if (cur && cur.asn !== asn) return void c.out.push(`% BGP is already running; AS is ${cur.asn}`);
      if (!cur) saveBgp(c, { asn, neighbors: [], networks: [] });
      c.s.ctx.process = asn;
      c.s.mode = "router-bgp";
    },
    true,
  ),
];

const leave = [cmd("exit", (c) => (c.s.mode = "config")), cmd("end", (c) => (c.s.mode = "priv"))];

function withOspf(fn: (c: Ctx, cfg: OspfConfig, a: Record<string, string>, negate: boolean) => void): CommandDef<Ctx>["run"] {
  return (c, a, negate) => {
    const cfg = ospfOf(c.d);
    if (!cfg) return void (c.s.mode = "config");
    fn(c, cfg, a, negate);
    saveOspf(c, cfg);
  };
}

function withBgp(fn: (c: Ctx, cfg: BgpConfig, a: Record<string, string>, negate: boolean) => void): CommandDef<Ctx>["run"] {
  return (c, a, negate) => {
    const cfg = bgpConfig(c.d);
    if (!cfg) return void (c.s.mode = "config");
    fn(c, cfg, a, negate);
    saveBgp(c, cfg);
  };
}

const routerOspf: CommandDef<Ctx>[] = [
  cmd(
    "network <ip:addr> <wildcard:wc> area <num:area:0-4294967295>",
    withOspf((_c, cfg, a, negate) => {
      const area = Number(a.area);
      const same = (n: OspfConfig["networks"][number]) => n.address === a.addr && n.wildcard === a.wc;
      cfg.networks = cfg.networks.filter((n) => !same(n));
      if (!negate) cfg.networks.push({ address: a.addr!, wildcard: a.wc!, area });
    }),
    true,
  ),
  cmd(
    "router-id <ip:id>",
    withOspf((_c, cfg, a, negate) => {
      if (negate) delete cfg.routerId;
      else cfg.routerId = a.id;
    }),
    true,
  ),
  cmd(
    "router-id",
    withOspf((c, cfg, _a, negate) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      delete cfg.routerId;
    }),
    true,
  ),
  cmd(
    "passive-interface <iface:if>",
    withOspf((c, cfg, a, negate) => {
      const i = findIface(c.d, a.if!);
      if (!i) return void c.out.push("% Invalid interface type and number");
      cfg.passive = cfg.passive.filter((x) => x !== i.id);
      if (!negate) cfg.passive.push(i.id);
    }),
    true,
  ),
  cmd(
    "default-information originate",
    withOspf((_c, cfg, _a, negate) => {
      cfg.defaultOriginate = !negate;
    }),
    true,
  ),
  cmd("log-adjacency-changes", noop, true),
  cmd("auto-cost reference-bandwidth <num:n:1-4294967>", noop, true),
  ...leave,
];

const routerBgp: CommandDef<Ctx>[] = [
  cmd(
    "neighbor <ip:addr> remote-as <num:as:1-4294967295>",
    withBgp((_c, cfg, a, negate) => {
      const n = cfg.neighbors.find((x) => x.address === a.addr);
      if (negate) cfg.neighbors = cfg.neighbors.filter((x) => x.address !== a.addr);
      else if (n) n.remoteAs = Number(a.as);
      else cfg.neighbors.push({ address: a.addr!, remoteAs: Number(a.as) });
    }),
    true,
  ),
  cmd(
    "neighbor <ip:addr> next-hop-self",
    withBgp((c, cfg, a, negate) => {
      const n = cfg.neighbors.find((x) => x.address === a.addr);
      if (!n) return void c.out.push(`% Specify remote-as or peer-group commands first`);
      if (negate) delete n.nextHopSelf;
      else n.nextHopSelf = true;
    }),
    true,
  ),
  cmd("neighbor <ip:addr> description <line:text>", noop, true),
  cmd(
    "neighbor <ip:addr>",
    withBgp((c, cfg, a, negate) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      cfg.neighbors = cfg.neighbors.filter((x) => x.address !== a.addr);
    }),
    true,
  ),
  cmd(
    "network <ip:net> mask <mask:mask>",
    withBgp((_c, cfg, a, negate) => {
      const prefix = maskPrefix(a.mask!);
      const network = formatIp(networkOf(parseIp(a.net!)!, prefix));
      cfg.networks = cfg.networks.filter((n) => !(n.network === network && n.prefix === prefix));
      if (!negate) cfg.networks.push({ network, prefix });
    }),
    true,
  ),
  cmd(
    "network <ip:net>",
    withBgp((_c, cfg, a, negate) => {
      const ip = parseIp(a.net!)!;
      const prefix = classfulPrefix(ip);
      const network = formatIp(networkOf(ip, prefix));
      cfg.networks = cfg.networks.filter((n) => !(n.network === network && n.prefix === prefix));
      if (!negate) cfg.networks.push({ network, prefix });
    }),
    true,
  ),
  cmd(
    "bgp router-id <ip:id>",
    withBgp((_c, cfg, a, negate) => {
      if (negate) delete cfg.routerId;
      else cfg.routerId = a.id;
    }),
    true,
  ),
  cmd("bgp log-neighbor-changes", noop, true),
  ...leave,
];

function maskPrefix(mask: string): number {
  const n = parseIp(mask)!;
  let p = 0;
  while (p < 32 && n & (0x80000000 >>> p)) p++;
  return p;
}

const iface: CommandDef<Ctx>[] = [
  cmd(
    "ip ospf cost <num:c:1-65535>",
    (c, a, negate) => {
      const cfg = ospfOf(c.d);
      if (!cfg) return void c.out.push("% OSPF is not configured: use 'router ospf <process-id>' first.");
      for (const id of c.s.ctx.ifaces) {
        if (negate) delete cfg.costs[id];
        else cfg.costs[id] = Number(a.c);
      }
      saveOspf(c, cfg);
    },
    true,
  ),
];

// ---------------------------------------------------------------- show commands

function drRoles(c: Ctx) {
  // DR = highest router ID among the routers sharing the segment (priority 1 everywhere).
  const net = c.sim.net;
  const roles = new Map<string, string>();
  for (const o of ospfInterfaces(net, c.d)) {
    if (o.iface.type === "loopback") {
      roles.set(o.iface.id, "LOOP");
      continue;
    }
    if (o.passive) {
      roles.set(o.iface.id, "DR");
      continue;
    }
    const nbrs = ospfNeighbors(net, c.d).filter((n) => n.local.iface.id === o.iface.id && !n.problem);
    const ids = [routerId(net, c.d), ...nbrs.map((n) => n.routerId)].sort((a, b) => parseIp(b)! - parseIp(a)!);
    const me = routerId(net, c.d);
    roles.set(o.iface.id, ids[0] === me ? "DR" : ids[1] === me ? "BDR" : "DROTHER");
    for (const n of nbrs) roles.set(`${o.iface.id}>${n.routerId}`, ids[0] === n.routerId ? "DR" : ids[1] === n.routerId ? "BDR" : "DROTHER");
  }
  return roles;
}

function showOspfNeighbor(c: Ctx) {
  const cfg = ospfOf(c.d);
  if (!cfg) return;
  const roles = drRoles(c);
  c.out.push("", `${pad("Neighbor ID", 16)}${pad("Pri", 6)}${pad("State", 16)}${pad("Dead Time", 12)}${pad("Address", 16)}Interface`);
  for (const n of ospfNeighbors(c.sim.net, c.d)) {
    if (n.problem) continue;
    const role = roles.get(`${n.local.iface.id}>${n.routerId}`) ?? "-";
    c.out.push(`${pad(n.routerId, 16)}${pad("  1", 6)}${pad(`FULL/${role === "DROTHER" ? "DROTHER" : role.padEnd(3)}`, 16)}${pad("00:00:35", 12)}${pad(n.iface.ip!.address, 16)}${n.local.iface.name}`);
  }
}

function showOspfInterfaceBrief(c: Ctx) {
  const cfg = ospfOf(c.d);
  if (!cfg) return;
  const roles = drRoles(c);
  const nbrs = ospfNeighbors(c.sim.net, c.d);
  c.out.push(`${pad("Interface", 11)}${pad("PID", 6)}${pad("Area", 16)}${pad("IP Address/Mask", 19)}${pad("Cost", 6)}${pad("State", 6)}Nbrs F/C`);
  for (const o of ospfInterfaces(c.sim.net, c.d)) {
    const n = nbrs.filter((x) => x.local.iface.id === o.iface.id && !x.problem).length;
    c.out.push(
      `${pad(shortName(o.iface.name), 11)}${pad(cfg.processId, 6)}${pad(o.area, 16)}${pad(`${o.iface.ip!.address}/${o.iface.ip!.prefix}`, 19)}${pad(o.cost, 6)}${pad(roles.get(o.iface.id) ?? "DR", 6)}${n}/${n}`,
    );
  }
}

const PROBLEM_TEXT: Record<string, string> = {
  area: "area mismatch",
  subnet: "subnet or mask mismatch",
  passive: "passive interface",
  routerId: "duplicate router ID",
};

function showOspf(c: Ctx) {
  const cfg = ospfOf(c.d);
  if (!cfg) return;
  const net = c.sim.net;
  const ifs = ospfInterfaces(net, c.d);
  const areas = [...new Set(ifs.map((o) => o.area))].sort((a, b) => a - b);
  c.out.push(` Routing Process "ospf ${cfg.processId}" with ID ${routerId(net, c.d)}`);
  c.out.push(` Number of areas in this router is ${areas.length}. ${areas.length} normal 0 stub 0 nssa`);
  if (areas.length > 1) c.out.push(" It is an area border router");
  if (cfg.defaultOriginate) c.out.push(" Originating a default route (default-information originate)");
  c.out.push(" Reference bandwidth unit is 100 mbps");
  for (const a of areas) {
    c.out.push(`    Area ${a === 0 ? "BACKBONE(0)" : a}`, `        Number of interfaces in this area is ${ifs.filter((o) => o.area === a).length}`);
  }
  // Teaching aid: routers that are seen on a segment but do not become neighbours.
  const stuck = ospfNeighbors(net, c.d).filter((n) => n.problem);
  if (stuck.length) {
    c.out.push("", " OSPF routers on the same segment without adjacency:");
    for (const n of stuck) c.out.push(`    ${n.device.name} (${n.routerId}) on ${n.local.iface.name}: ${PROBLEM_TEXT[n.problem!]}`);
  }
}

function showBgpSummary(c: Ctx) {
  const cfg = bgpConfig(c.d);
  if (!cfg) return void c.out.push("% BGP not active");
  const st = bgpState(c.sim.net, c.sim.routes);
  const best = st.best.get(c.d.id);
  c.out.push(`BGP router identifier ${cfg.routerId ?? autoRouterId(c.sim.net, c.d)}, local AS number ${cfg.asn}`);
  c.out.push(`BGP table version is ${(best?.size ?? 0) + 1}, main routing table version ${(best?.size ?? 0) + 1}`, "");
  c.out.push(`${pad("Neighbor", 16)}${pad("V", 4)}${lpad("AS", 10)} MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd`);
  for (const s of st.sessions.filter((x) => x.device.id === c.d.id)) {
    const up = s.state === "Established";
    c.out.push(
      `${pad(s.neighbor.address, 16)}${pad("4", 4)}${lpad(s.neighbor.remoteAs, 10)}${lpad(up ? 12 : 0, 8)}${lpad(up ? 12 : 0, 8)}${lpad(up ? (best?.size ?? 0) + 1 : 0, 9)}${lpad(0, 5)}${lpad(0, 5)} ${pad(up ? "00:05:12" : "never", 9)}${up ? s.prefixes : s.state}`,
    );
  }
}

function showBgp(c: Ctx) {
  const cfg = bgpConfig(c.d);
  if (!cfg) return void c.out.push("% BGP not active");
  const st = bgpState(c.sim.net, c.sim.routes);
  const best = [...(st.best.get(c.d.id)?.values() ?? [])].sort((a, b) => a.network - b.network || a.prefix - b.prefix);
  c.out.push(`BGP table version is ${best.length + 1}, local router ID is ${cfg.routerId ?? autoRouterId(c.sim.net, c.d)}`);
  c.out.push("Status codes: * valid, > best, i - internal", "Origin codes: i - IGP", "");
  c.out.push(`     ${pad("Network", 17)}${pad("Next Hop", 20)}Metric LocPrf Weight Path`);
  for (const p of best) {
    c.out.push(
      ` *>${p.local || p.ebgp ? " " : "i"} ${pad(`${formatIp(p.network)}/${p.prefix}`, 17)}${pad(nextHopText(p), 20)}${lpad(0, 6)}${lpad(p.local || p.ebgp ? "" : 100, 7)}${lpad(p.local ? 32768 : 0, 7)} ${formatPath(p)}`,
    );
  }
}

function showProtocols(c: Ctx) {
  const o = ospfOf(c.d);
  const b = bgpConfig(c.d);
  if (o) {
    c.out.push(`Routing Protocol is "ospf ${o.processId}"`, `  Router ID ${routerId(c.sim.net, c.d)}`, "  Routing for Networks:");
    for (const n of o.networks) c.out.push(`    ${n.address} ${n.wildcard} area ${n.area}`);
    const passive = o.passive.map((id) => c.d.interfaces.find((i) => i.id === id)?.name).filter(Boolean);
    if (passive.length) c.out.push("  Passive Interface(s):", ...passive.map((x) => `    ${x}`));
    c.out.push("  Distance: (default is 110)", "");
  }
  if (b) {
    c.out.push(`Routing Protocol is "bgp ${b.asn}"`, "  Neighbor(s):", "    Address          FiltIn FiltOut DistIn DistOut Weight RouteMap");
    for (const n of b.neighbors) c.out.push(`    ${n.address}`);
    c.out.push("  Routing for Networks:", ...b.networks.map((n) => `    ${n.network} mask ${prefixToMask(n.prefix)}`), "  Distance: external 20 internal 200 local 200", "");
  }
  if (!o && !b) c.out.push('*** IP Routing is NSF aware ***', "", 'Routing Protocol is "application"');
}

function routeFilter(prefixes: string[]) {
  return (c: Ctx) => {
    const lines = ipRoute(c.d, c.sim);
    const head = lines.slice(0, 5);
    c.out.push(...head, ...lines.slice(5).filter((l) => prefixes.some((p) => l.startsWith(p))));
  };
}

const show: CommandDef<Ctx>[] = [
  cmd("show ip ospf neighbor", showOspfNeighbor),
  cmd("show ip ospf interface brief", showOspfInterfaceBrief),
  cmd("show ip ospf", showOspf),
  cmd("show ip bgp summary", showBgpSummary),
  cmd("show ip bgp", showBgp),
  cmd("show ip protocols", showProtocols),
  cmd("show ip route ospf", routeFilter(["O"])),
  cmd("show ip route bgp", routeFilter(["B"])),
  cmd("show ip route static", routeFilter(["S"])),
  cmd("show ip route connected", routeFilter(["C", "L"])),
];

registerCliExtension<Ctx>({
  commands(mode) {
    switch (mode) {
      case "user":
      case "priv":
        return show;
      case "config":
        return config;
      case "if":
      case "if-range":
      case "subif":
        return iface;
      case "router-ospf":
        return routerOspf;
      case "router-bgp":
        return routerBgp;
      default:
        return [];
    }
  },
  prompt: (mode) => (mode === "router-ospf" || mode === "router-bgp" ? "(config-router)#" : undefined),
});
