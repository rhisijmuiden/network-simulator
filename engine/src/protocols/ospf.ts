import { formatIp, networkOf, parseIp, wildcardMatch } from "../ip.js";
import type { Device, Interface } from "../model.js";
import type { NetworkIndex } from "../network.js";
import { registerRoutingProtocol, type RouteEntry } from "../routing.js";

/**
 * OSPF (single process per device), computed in its converged state: adjacencies are formed
 * over shared broadcast domains, then every router runs SPF over the link-state graph.
 * Areas are tracked for adjacency checks and to mark inter-area routes; the backbone rule
 * (every area attached to area 0) is not enforced.
 */
export interface OspfConfig {
  processId: number;
  routerId?: string;
  networks: { address: string; wildcard: string; area: number }[];
  /** Interface ids. */
  passive: string[];
  /** Interface id -> cost set with `ip ospf cost`. */
  costs: Record<string, number>;
  defaultOriginate?: boolean;
}

export const OSPF = "ospf";

export function ospfConfig(d: Device): OspfConfig | undefined {
  const c = d.protocols[OSPF] as Partial<OspfConfig> | undefined;
  if (!c || typeof c !== "object" || typeof c.processId !== "number") return undefined;
  return {
    processId: c.processId,
    routerId: typeof c.routerId === "string" ? c.routerId : undefined,
    networks: Array.isArray(c.networks) ? c.networks.filter((n) => n && parseIp(n.address) !== null && parseIp(n.wildcard) !== null && Number.isInteger(n.area)) : [],
    passive: Array.isArray(c.passive) ? c.passive.filter((x) => typeof x === "string") : [],
    costs: c.costs && typeof c.costs === "object" ? c.costs : {},
    defaultOriginate: c.defaultOriginate === true,
  };
}

export interface OspfIface {
  iface: Interface;
  area: number;
  cost: number;
  passive: boolean;
}

/** Default cost with a reference bandwidth of 100 Mb/s, as IOS does. */
export function defaultCost(i: Interface): number {
  if (i.type === "loopback") return 1;
  return Math.max(1, Math.floor(100 / Math.max(1, i.speed)));
}

/** Interfaces on which OSPF runs: up, addressed, and matched by a `network ... area` statement. */
export function ospfInterfaces(net: NetworkIndex, d: Device, cfg = ospfConfig(d)): OspfIface[] {
  if (!cfg || !d.ipRouting) return [];
  const out: OspfIface[] = [];
  for (const i of net.l3Interfaces(d)) {
    if (!net.isUp(i)) continue;
    const ip = parseIp(i.ip!.address)!;
    const n = cfg.networks.find((x) => wildcardMatch(ip, parseIp(x.address)!, parseIp(x.wildcard)!));
    if (!n) continue;
    out.push({ iface: i, area: n.area, cost: cfg.costs[i.id] ?? defaultCost(i), passive: cfg.passive.includes(i.id) || i.type === "loopback" });
  }
  return out;
}

export function routerId(net: NetworkIndex, d: Device, cfg = ospfConfig(d)): string {
  return cfg?.routerId ?? autoRouterId(net, d);
}

/** Highest loopback address, else highest address of an up interface (as IOS picks a router ID). */
export function autoRouterId(net: NetworkIndex, d: Device): string {
  const up = net.l3Interfaces(d).filter((i) => net.isUp(i));
  const pick = (list: Interface[]) => list.map((i) => parseIp(i.ip!.address)!).sort((a, b) => b - a)[0];
  const best = pick(up.filter((i) => i.type === "loopback")) ?? pick(up);
  return best === undefined ? "0.0.0.0" : formatIp(best);
}

export type NeighborProblem = "area" | "subnet" | "passive" | "routerId";

export interface OspfNeighbor {
  local: OspfIface;
  device: Device;
  iface: Interface;
  routerId: string;
  /** Undefined when the adjacency is up (FULL). */
  problem?: NeighborProblem;
}

/** Other OSPF routers seen on each OSPF interface, with the reason when no adjacency forms. */
export function ospfNeighbors(net: NetworkIndex, d: Device): OspfNeighbor[] {
  const out: OspfNeighbor[] = [];
  const myId = routerId(net, d);
  for (const l of ospfInterfaces(net, d)) {
    if (l.iface.type === "loopback") continue;
    for (const p of net.segment(l.iface)) {
      if (p.device.id === d.id) continue;
      const remote = ospfInterfaces(net, p.device).find((x) => x.iface.id === p.iface.id);
      if (!remote) continue;
      const rid = routerId(net, p.device);
      let problem: NeighborProblem | undefined;
      if (l.passive || remote.passive) problem = "passive";
      else if (l.area !== remote.area) problem = "area";
      else if (l.iface.ip!.prefix !== p.iface.ip!.prefix || networkOf(parseIp(l.iface.ip!.address)!, l.iface.ip!.prefix) !== networkOf(parseIp(p.iface.ip!.address)!, p.iface.ip!.prefix)) problem = "subnet";
      else if (rid === myId) problem = "routerId";
      out.push({ local: l, device: p.device, iface: p.iface, routerId: rid, problem });
    }
  }
  return out;
}

type Hop = { nextHop: number; iface: string };

function compute(net: NetworkIndex): Map<string, RouteEntry[]> {
  const routers = [...net.devices.values()].filter((d) => ospfConfig(d) && d.ipRouting);
  const ifaces = new Map(routers.map((d) => [d.id, ospfInterfaces(net, d)]));
  const edges = new Map<string, { to: string; cost: number; hop: Hop }[]>();
  for (const d of routers) {
    edges.set(
      d.id,
      ospfNeighbors(net, d)
        .filter((n) => !n.problem)
        .map((n) => ({ to: n.device.id, cost: n.local.cost, hop: { nextHop: parseIp(n.iface.ip!.address)!, iface: n.local.iface.id } })),
    );
  }
  // Prefixes each router advertises: its OSPF interfaces (loopbacks as /32, as IOS does).
  const prefixes = new Map<string, { network: number; prefix: number; cost: number; area: number }[]>();
  for (const d of routers) {
    prefixes.set(
      d.id,
      ifaces.get(d.id)!.map((o) => {
        const ip = parseIp(o.iface.ip!.address)!;
        const prefix = o.iface.type === "loopback" ? 32 : o.iface.ip!.prefix;
        return { network: networkOf(ip, prefix), prefix, cost: o.iface.type === "loopback" ? 1 : o.cost, area: o.area };
      }),
    );
  }
  const originators = routers.filter((d) => ospfConfig(d)!.defaultOriginate && d.staticRoutes.some((r) => r.prefix === 0));

  const result = new Map<string, RouteEntry[]>();
  for (const src of routers) {
    const dist = new Map<string, number>([[src.id, 0]]);
    const hops = new Map<string, Hop[]>([[src.id, []]]);
    const done = new Set<string>();
    for (;;) {
      let u: string | undefined;
      for (const [id, dv] of dist) if (!done.has(id) && (u === undefined || dv < dist.get(u)!)) u = id;
      if (u === undefined) break;
      done.add(u);
      for (const e of edges.get(u) ?? []) {
        const nd = dist.get(u)! + e.cost;
        const via = u === src.id ? [e.hop] : hops.get(u)!;
        const cur = dist.get(e.to);
        if (cur === undefined || nd < cur) {
          dist.set(e.to, nd);
          hops.set(e.to, [...via]);
        } else if (nd === cur && !done.has(e.to)) {
          const list = hops.get(e.to)!;
          for (const h of via) if (!list.some((x) => x.nextHop === h.nextHop && x.iface === h.iface)) list.push(h);
        }
      }
    }
    const myAreas = new Set(ifaces.get(src.id)!.map((o) => o.area));
    const own = new Set(prefixes.get(src.id)!.map((p) => `${p.network}/${p.prefix}`));
    const best = new Map<string, { network: number; prefix: number; metric: number; hops: Hop[]; ia: boolean }>();
    for (const d of routers) {
      if (d.id === src.id || !dist.has(d.id)) continue;
      for (const p of prefixes.get(d.id)!) {
        const key = `${p.network}/${p.prefix}`;
        if (own.has(key)) continue;
        const metric = dist.get(d.id)! + p.cost;
        const cur = best.get(key);
        const h = hops.get(d.id)!;
        if (!cur || metric < cur.metric) best.set(key, { network: p.network, prefix: p.prefix, metric, hops: [...h], ia: !myAreas.has(p.area) });
        else if (metric === cur.metric) for (const x of h) if (!cur.hops.some((y) => y.nextHop === x.nextHop)) cur.hops.push(x);
      }
    }
    const routes: RouteEntry[] = [];
    for (const b of best.values())
      for (const h of b.hops) routes.push({ network: b.network, prefix: b.prefix, nextHop: h.nextHop, iface: h.iface, protocol: OSPF, distance: 110, metric: b.metric, code: b.ia ? "O IA" : undefined });
    // Default route from `default-information originate` (type E2, metric 1): via the nearest originator.
    const orig = originators.filter((d) => d.id !== src.id && dist.has(d.id)).sort((a, b) => dist.get(a.id)! - dist.get(b.id)!)[0];
    if (orig) for (const h of hops.get(orig.id)!) routes.push({ network: 0, prefix: 0, nextHop: h.nextHop, iface: h.iface, protocol: OSPF, distance: 110, metric: 1, code: "O*E2" });
    result.set(src.id, routes);
  }
  return result;
}

export function ospfRunningConfig(cfg: OspfConfig, d: Device): string[] {
  const name = (id: string) => d.interfaces.find((i) => i.id === id)?.name;
  const out = [`router ospf ${cfg.processId}`];
  if (cfg.routerId) out.push(` router-id ${cfg.routerId}`);
  for (const id of cfg.passive) if (name(id)) out.push(` passive-interface ${name(id)}`);
  for (const n of cfg.networks) out.push(` network ${n.address} ${n.wildcard} area ${n.area}`);
  if (cfg.defaultOriginate) out.push(" default-information originate");
  return out;
}

registerRoutingProtocol({
  id: OSPF,
  code: "O",
  distance: 110,
  compute: ({ net }) => compute(net),
  runningConfig: (_c, d) => {
    const cfg = ospfConfig(d);
    return cfg ? ospfRunningConfig(cfg, d) : [];
  },
  interfaceConfig: (_c, d, i) => {
    const cost = ospfConfig(d)?.costs[i.id];
    return cost ? [` ip ospf cost ${cost}`] : [];
  },
});

