import { formatIp, networkOf, parseIp, prefixToMask } from "../ip.js";
import type { Device } from "../model.js";
import type { NetworkIndex } from "../network.js";
import { longestMatch, registerRoutingProtocol, type RouteEntry } from "../routing.js";

/**
 * BGP-4, computed in its converged state. Sessions come up between configured neighbours
 * that point at each other with the right AS numbers and can reach each other; eBGP needs
 * a directly connected neighbour. Paths are exchanged with the usual rules (AS-path loop
 * check, no iBGP-to-iBGP re-advertising, next hop unchanged towards iBGP peers unless
 * next-hop-self) and the best path is chosen on AS-path length, then eBGP over iBGP.
 */
export interface BgpNeighborConfig {
  address: string;
  remoteAs: number;
  nextHopSelf?: boolean;
}

export interface BgpConfig {
  asn: number;
  routerId?: string;
  neighbors: BgpNeighborConfig[];
  networks: { network: string; prefix: number }[];
}

export const BGP = "bgp";

export function bgpConfig(d: Device): BgpConfig | undefined {
  const c = d.protocols[BGP] as Partial<BgpConfig> | undefined;
  if (!c || typeof c !== "object" || typeof c.asn !== "number") return undefined;
  return {
    asn: c.asn,
    routerId: typeof c.routerId === "string" ? c.routerId : undefined,
    neighbors: Array.isArray(c.neighbors) ? c.neighbors.filter((n) => n && parseIp(n.address) !== null && Number.isInteger(n.remoteAs)) : [],
    networks: Array.isArray(c.networks) ? c.networks.filter((n) => n && parseIp(n.network) !== null && Number.isInteger(n.prefix)) : [],
  };
}

export type SessionState = "Established" | "Idle" | "Active";
export type SessionProblem = "noPeer" | "remoteAs" | "notConfigured" | "unreachable" | "notConnected";

export interface BgpSession {
  device: Device;
  neighbor: BgpNeighborConfig;
  peer?: Device;
  /** The address the peer uses for this device. */
  localAddress?: number;
  state: SessionState;
  problem?: SessionProblem;
  ebgp: boolean;
  prefixes: number;
}

export interface BgpPath {
  network: number;
  prefix: number;
  asPath: number[];
  /** 0 for locally originated paths. */
  nextHop: number;
  from?: string;
  ebgp: boolean;
  local: boolean;
}

function addresses(net: NetworkIndex, d: Device): number[] {
  return net
    .l3Interfaces(d)
    .filter((i) => net.isUp(i))
    .map((i) => parseIp(i.ip!.address)!);
}

function sessionsOf(net: NetworkIndex, routes: Map<string, RouteEntry[]>): BgpSession[] {
  const out: BgpSession[] = [];
  for (const d of net.devices.values()) {
    const cfg = bgpConfig(d);
    if (!cfg || !d.ipRouting) continue;
    for (const n of cfg.neighbors) {
      const addr = parseIp(n.address)!;
      const owner = net.ownerOf(addr);
      const peer = owner?.device;
      const pcfg = peer ? bgpConfig(peer) : undefined;
      const ebgp = n.remoteAs !== cfg.asn;
      const s: BgpSession = { device: d, neighbor: n, peer, state: "Idle", ebgp, prefixes: 0 };
      out.push(s);
      if (!peer || !pcfg || peer.id === d.id || !peer.ipRouting || !owner!.iface.enabled) {
        s.problem = "noPeer";
        continue;
      }
      const mine = addresses(net, d);
      const back = pcfg.neighbors.find((m) => mine.includes(parseIp(m.address)!));
      if (!back) {
        s.problem = "notConfigured";
        s.state = "Active";
        continue;
      }
      if (pcfg.asn !== n.remoteAs || back.remoteAs !== cfg.asn) {
        s.problem = "remoteAs";
        s.state = "Active";
        continue;
      }
      s.localAddress = parseIp(back.address)!;
      const there = longestMatch(routes.get(d.id) ?? [], addr);
      const backRoute = longestMatch(routes.get(peer.id) ?? [], s.localAddress);
      if (!there || !backRoute) {
        s.problem = "unreachable";
        s.state = "Active";
        continue;
      }
      if (ebgp && there.protocol !== "connected") {
        s.problem = "notConnected";
        s.state = "Active";
        continue;
      }
      s.state = "Established";
    }
  }
  return out;
}

const better = (a: BgpPath, b: BgpPath) => {
  if (a.local !== b.local) return a.local;
  if (a.asPath.length !== b.asPath.length) return a.asPath.length < b.asPath.length;
  if (a.ebgp !== b.ebgp) return a.ebgp;
  return a.nextHop < b.nextHop;
};

/** Converged BGP state: sessions, and the best path per prefix on every BGP router. */
export function bgpState(net: NetworkIndex, routes: Map<string, RouteEntry[]>) {
  const sessions = sessionsOf(net, routes);
  const up = sessions.filter((s) => s.state === "Established");
  const local = new Map<string, BgpPath[]>();
  for (const d of net.devices.values()) {
    const cfg = bgpConfig(d);
    if (!cfg || !d.ipRouting) continue;
    const table = routes.get(d.id) ?? [];
    local.set(
      d.id,
      cfg.networks
        .map((n) => ({ network: networkOf(parseIp(n.network)!, n.prefix), prefix: n.prefix }))
        // IOS only announces a network that is in the routing table with exactly this mask.
        .filter((n) => table.some((r) => r.network === n.network && r.prefix === n.prefix && r.protocol !== BGP))
        .map((n) => ({ ...n, asPath: [], nextHop: 0, ebgp: false, local: true })),
    );
  }
  let best = new Map<string, Map<string, BgpPath>>();
  const choose = (incoming: Map<string, BgpPath[]>) => {
    const next = new Map<string, Map<string, BgpPath>>();
    for (const [id, paths] of local) {
      const table = routes.get(id) ?? [];
      const m = new Map<string, BgpPath>();
      for (const p of [...paths, ...(incoming.get(id) ?? [])]) {
        if (!p.local && !longestMatch(table, p.nextHop)) continue; // next hop must be reachable
        const key = `${p.network}/${p.prefix}`;
        const cur = m.get(key);
        if (!cur || better(p, cur)) m.set(key, p);
      }
      next.set(id, m);
    }
    return next;
  };
  best = choose(new Map());
  for (let round = 0; round < 40; round++) {
    const incoming = new Map<string, BgpPath[]>();
    for (const s of up) {
      // Advertisements from the peer to s.device.
      const peer = s.peer!;
      const pcfg = bgpConfig(peer)!;
      const back = pcfg.neighbors.find((m) => parseIp(m.address) === s.localAddress)!;
      const peerAddr = parseIp(s.neighbor.address)!;
      const asn = bgpConfig(s.device)!.asn;
      for (const p of best.get(peer.id)?.values() ?? []) {
        if (p.from === s.device.id) continue;
        if (!s.ebgp && !p.local && !p.ebgp) continue; // iBGP split horizon
        const asPath = s.ebgp ? [pcfg.asn, ...p.asPath] : p.asPath;
        if (asPath.includes(asn)) continue; // loop prevention
        const nextHop = s.ebgp || p.local || back.nextHopSelf ? peerAddr : p.nextHop;
        const list = incoming.get(s.device.id) ?? [];
        list.push({ network: p.network, prefix: p.prefix, asPath, nextHop, from: peer.id, ebgp: s.ebgp, local: false });
        incoming.set(s.device.id, list);
      }
    }
    const next = choose(incoming);
    const sig = (m: Map<string, Map<string, BgpPath>>) =>
      JSON.stringify([...m].map(([id, t]) => [id, [...t].map(([k, p]) => [k, p.nextHop, p.asPath.join(" "), p.from])]));
    if (sig(next) === sig(best)) break;
    best = next;
    for (const s of up) s.prefixes = [...(next.get(s.device.id)?.values() ?? [])].filter((p) => p.from === s.peer!.id).length;
  }
  return { sessions, best };
}

function compute(net: NetworkIndex, routes: Map<string, RouteEntry[]>): Map<string, RouteEntry[]> {
  const { best } = bgpState(net, routes);
  const out = new Map<string, RouteEntry[]>();
  for (const [id, table] of best)
    out.set(
      id,
      [...table.values()].filter((p) => !p.local).map((p) => ({ network: p.network, prefix: p.prefix, nextHop: p.nextHop, protocol: BGP, distance: p.ebgp ? 20 : 200, metric: 0 })),
    );
  return out;
}

export function bgpRunningConfig(cfg: BgpConfig): string[] {
  const out = [`router bgp ${cfg.asn}`];
  if (cfg.routerId) out.push(` bgp router-id ${cfg.routerId}`);
  for (const n of cfg.neighbors) {
    out.push(` neighbor ${n.address} remote-as ${n.remoteAs}`);
    if (n.nextHopSelf) out.push(` neighbor ${n.address} next-hop-self`);
  }
  for (const n of cfg.networks) out.push(` network ${n.network} mask ${prefixToMask(n.prefix)}`);
  return out;
}

export function formatPath(p: BgpPath): string {
  return `${p.asPath.join(" ")}${p.asPath.length ? " " : ""}i`;
}

export const nextHopText = (p: BgpPath) => (p.local ? "0.0.0.0" : formatIp(p.nextHop));

registerRoutingProtocol({
  id: BGP,
  code: "B",
  distance: 20,
  compute: ({ net, routes }) => compute(net, routes),
  runningConfig: (_c, d) => {
    const cfg = bgpConfig(d);
    return cfg ? bgpRunningConfig(cfg) : [];
  },
});
