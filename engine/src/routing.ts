import { inSubnet, networkOf, parseIp } from "./ip.js";
import type { Device, Interface } from "./model.js";
import type { NetworkIndex } from "./network.js";

export type RouteProtocol = "connected" | "local" | "static" | "gateway" | (string & {});

export interface RouteEntry {
  network: number;
  prefix: number;
  nextHop?: number;
  /** Exit interface id. */
  iface?: string;
  protocol: RouteProtocol;
  distance: number;
  metric: number;
  /** Code shown in `show ip route` when it differs from the protocol's own, for example "O IA" or "O*E2". */
  code?: string;
}

/**
 * Hook for dynamic routing protocols (OSPF, BGP in later phases). A provider sees the whole
 * converged network and returns the routes it would install on each device; the routing table
 * then keeps the best route per prefix by administrative distance and metric.
 */
export interface RoutingProtocol {
  id: string;
  /** Cisco code letter shown in the routing table, for example "O" for OSPF. */
  code: string;
  distance: number;
  /**
   * `routes` holds what is known so far (connected, static and the protocols registered
   * earlier), so that BGP can check whether a neighbour or next hop is reachable.
   */
  compute(ctx: { net: NetworkIndex; connected: Map<string, RouteEntry[]>; routes: Map<string, RouteEntry[]> }): Map<string, RouteEntry[]>;
  /** Lines for `show running-config`, from the device's `protocols[id]` settings. */
  runningConfig?(config: unknown, device: Device): string[];
  /** Extra lines inside an interface block of `show running-config` (for example `ip ospf cost`). */
  interfaceConfig?(config: unknown, device: Device, iface: Interface): string[];
}

const protocols: RoutingProtocol[] = [];

export function registerRoutingProtocol(p: RoutingProtocol): void {
  const i = protocols.findIndex((x) => x.id === p.id);
  if (i >= 0) protocols[i] = p;
  else protocols.push(p);
}

export function routingProtocols(): readonly RoutingProtocol[] {
  return protocols;
}

export const ROUTE_CODES: Record<string, string> = { connected: "C", local: "L", static: "S", gateway: "S*" };

function connectedRoutes(net: NetworkIndex, d: Device): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const i of net.l3Interfaces(d)) {
    if (!net.isUp(i)) continue;
    const ip = parseIp(i.ip!.address);
    if (ip === null) continue;
    out.push({ network: networkOf(ip, i.ip!.prefix), prefix: i.ip!.prefix, iface: i.id, protocol: "connected", distance: 0, metric: 0 });
    if (i.ip!.prefix < 32) out.push({ network: ip, prefix: 32, iface: i.id, protocol: "local", distance: 0, metric: 0 });
  }
  return out;
}

/** Longest prefix match in a list of routes. */
export function longestMatch(routes: RouteEntry[], ip: number): RouteEntry | undefined {
  let best: RouteEntry | undefined;
  for (const r of routes) {
    if (!inSubnet(ip, r.network, r.prefix)) continue;
    if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && (r.distance < best.distance || (r.distance === best.distance && r.metric < best.metric)))) best = r;
  }
  return best;
}

function staticRoutes(net: NetworkIndex, d: Device, connected: RouteEntry[]): RouteEntry[] {
  const out: RouteEntry[] = [];
  const ifaceUp = (id: string | undefined) => {
    const i = id ? d.interfaces.find((x) => x.id === id) : undefined;
    return i ? net.isUp(i) : false;
  };
  const candidates: RouteEntry[] = [];
  for (const s of d.staticRoutes) {
    const network = parseIp(s.network);
    if (network === null) continue;
    const nextHop = s.nextHop ? parseIp(s.nextHop) ?? undefined : undefined;
    candidates.push({ network: networkOf(network, s.prefix), prefix: s.prefix, nextHop, iface: s.iface, protocol: "static", distance: s.distance, metric: 0 });
  }
  if (!d.ipRouting && d.defaultGateway) {
    const gw = parseIp(d.defaultGateway);
    if (gw !== null) candidates.push({ network: 0, prefix: 0, nextHop: gw, protocol: "gateway", distance: 1, metric: 0 });
  }
  // A static route is installed when its exit interface is up or its next hop is reachable
  // (recursively, through connected or other installed static routes).
  let changed = true;
  const installed = new Set<RouteEntry>();
  while (changed) {
    changed = false;
    for (const c of candidates) {
      if (installed.has(c)) continue;
      let ok = false;
      if (c.iface) ok = ifaceUp(c.iface);
      else if (c.nextHop !== undefined) {
        const via = longestMatch([...connected, ...installed], c.nextHop);
        ok = Boolean(via && !(via.network === c.network && via.prefix === c.prefix));
      }
      if (ok) {
        installed.add(c);
        changed = true;
      }
    }
  }
  out.push(...installed);
  return out;
}

/** Builds the routing table of every device: connected, static and protocol routes, best per prefix. */
export function buildRoutingTables(net: NetworkIndex): Map<string, RouteEntry[]> {
  const connected = new Map<string, RouteEntry[]>();
  for (const d of net.devices.values()) connected.set(d.id, connectedRoutes(net, d));
  const all = new Map<string, RouteEntry[]>();
  for (const d of net.devices.values()) all.set(d.id, [...connected.get(d.id)!, ...staticRoutes(net, d, connected.get(d.id)!)]);
  for (const p of protocols) {
    for (const [id, routes] of p.compute({ net, connected, routes: all })) all.get(id)?.push(...routes);
  }
  const tables = new Map<string, RouteEntry[]>();
  for (const [id, routes] of all) {
    const best = new Map<string, RouteEntry[]>();
    for (const r of routes) {
      const key = `${r.network}/${r.prefix}`;
      const cur = best.get(key);
      if (!cur || r.distance < cur[0]!.distance || (r.distance === cur[0]!.distance && r.metric < cur[0]!.metric)) best.set(key, [r]);
      else if (r.distance === cur[0]!.distance && r.metric === cur[0]!.metric && r.protocol !== "local") cur.push(r);
    }
    tables.set(
      id,
      [...best.values()].flat().sort((a, b) => a.network - b.network || a.prefix - b.prefix),
    );
  }
  return tables;
}

export interface Resolved {
  route: RouteEntry;
  iface: Interface;
  nextHop: number;
}

/** Resolves the exit interface and next-hop address for a destination, following recursive routes. */
export function resolveRoute(net: NetworkIndex, device: Device, table: RouteEntry[], dst: number): Resolved | undefined {
  let target = dst;
  let first: RouteEntry | undefined;
  for (let depth = 0; depth < 5; depth++) {
    const r = longestMatch(table, target);
    if (!r) return undefined;
    first ??= r;
    if (r.iface) {
      const iface = device.interfaces.find((i) => i.id === r.iface);
      if (!iface) return undefined;
      // Directly connected (or exit-interface-only static): ARP for the target itself.
      return { route: first, iface, nextHop: r.nextHop ?? target };
    }
    if (r.nextHop === undefined) return undefined;
    target = r.nextHop;
  }
  return undefined;
}
