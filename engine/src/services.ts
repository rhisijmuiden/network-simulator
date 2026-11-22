import { formatIp, inSubnet, networkOf, parseIp } from "./ip.js";
import { isHost, type Device, type DhcpPool, type Interface, type Topology } from "./model.js";
import { NetworkIndex } from "./network.js";
import { buildRoutingTables, longestMatch } from "./routing.js";

/** TCP ports a device accepts: its own list plus the ports of the services it runs. */
export function tcpPorts(d: Device): number[] {
  const s = d.services;
  const out = new Set(d.listenPorts);
  if (s?.web?.enabled) [80, 443].forEach((p) => out.add(p));
  if (s?.files?.enabled) [21, 445].forEach((p) => out.add(p));
  if (s?.dns?.enabled) out.add(53);
  return [...out];
}

/** UDP ports a device answers on. */
export function udpPorts(d: Device): number[] {
  const out: number[] = [];
  if (d.services?.dns?.enabled) out.push(53);
  if (d.services?.dhcp?.enabled) out.push(67);
  return out;
}

export interface Lease {
  iface: string;
  address: string;
  prefix: number;
  gateway?: string;
  dns?: string;
  /** Device id of the DHCP server. */
  server: string;
  /** Router interface that relayed the request (ip helper-address). */
  relay?: string;
  pool: string;
}

export type LeaseFailure = { iface: string; error: "noServer" | "noPool" | "exhausted" };

export interface DhcpResult {
  topology: Topology;
  leases: Map<string, Lease | LeaseFailure>;
}

function poolFor(server: Device, address: number): DhcpPool | undefined {
  return server.services?.dhcp?.pools.find((p) => {
    const net = parseIp(p.network);
    return net !== null && inSubnet(address, networkOf(net, p.prefix), p.prefix);
  });
}

/**
 * Hands out DHCP addresses, in the converged state: every host interface with `dhcp` gets an
 * address from a DHCP server in its broadcast domain, or through a router interface with
 * `ip helper-address`. Returns a copy of the topology with the leases applied.
 */
export function resolveDhcp(topology: Topology): DhcpResult {
  const leases = new Map<string, Lease | LeaseFailure>();
  const clients = topology.devices.flatMap((d) => (isHost(d) ? d.interfaces.filter((i) => i.dhcp).map((i) => ({ d, i })) : []));
  if (!clients.length) return { topology, leases };
  const net = new NetworkIndex(topology);
  let routes: ReturnType<typeof buildRoutingTables> | undefined;
  const used = new Set<number>();
  for (const d of topology.devices) for (const i of d.interfaces) if (i.ip && !i.dhcp) used.add(parseIp(i.ip.address)!);
  const next = structuredCloneTopology(topology);
  for (const { d, i } of clients) {
    const seg = net.segment(i);
    let offer: { server: Device; pool: DhcpPool; relay?: Interface } | undefined;
    let error: LeaseFailure["error"] = "noServer";
    // A DHCP server on the same segment answers from the pool of its own subnet.
    for (const p of seg) {
      if (!p.device.services?.dhcp?.enabled || !isHost(p.device)) continue;
      const pool = poolFor(p.device, parseIp(p.iface.ip!.address)!);
      if (pool) {
        offer = { server: p.device, pool };
        break;
      }
      error = "noPool";
    }
    // Otherwise a router on the segment relays to its helper address (giaddr = the router interface).
    if (!offer) {
      for (const p of seg) {
        const helper = p.iface.helperAddress ? parseIp(p.iface.helperAddress) : null;
        if (helper === null || !p.device.ipRouting) continue;
        const owner = net.ownerOf(helper);
        if (!owner?.device.services?.dhcp?.enabled || !net.isUp(owner.iface)) continue;
        routes ??= buildRoutingTables(net);
        if (!longestMatch(routes.get(p.device.id) ?? [], helper)) continue;
        const pool = poolFor(owner.device, parseIp(p.iface.ip!.address)!);
        if (pool) {
          offer = { server: owner.device, pool, relay: p.iface };
          break;
        }
        error = "noPool";
      }
    }
    if (!offer) {
      leases.set(i.id, { iface: i.id, error });
      continue;
    }
    const { pool } = offer;
    const from = parseIp(pool.start)!;
    const to = parseIp(pool.end)!;
    const gw = pool.gateway ? parseIp(pool.gateway) : null;
    let address: number | undefined;
    for (let a = from; a <= to && a - from < 65536; a++) if (!used.has(a) && a !== gw) {
      address = a;
      break;
    }
    if (address === undefined) {
      leases.set(i.id, { iface: i.id, error: "exhausted" });
      continue;
    }
    used.add(address);
    const lease: Lease = { iface: i.id, address: formatIp(address), prefix: pool.prefix, gateway: pool.gateway, dns: pool.dns, server: offer.server.id, relay: offer.relay?.id, pool: pool.name };
    leases.set(i.id, lease);
    const nd = next.devices.find((x) => x.id === d.id)!;
    const ni = nd.interfaces.find((x) => x.id === i.id)!;
    ni.ip = { address: lease.address, prefix: lease.prefix };
    if (lease.gateway) nd.defaultGateway = lease.gateway;
    if (lease.dns) nd.dnsServers = [lease.dns];
  }
  return { topology: next, leases };
}

function structuredCloneTopology(t: Topology): Topology {
  return JSON.parse(JSON.stringify(t)) as Topology;
}

/** Looks a name up in a DNS server's records (case-insensitive, trailing dot ignored). */
export function dnsLookup(server: Device, name: string): string | undefined {
  const n = name.toLowerCase().replace(/\.$/, "");
  return server.services?.dns?.records.find((r) => r.name.toLowerCase().replace(/\.$/, "") === n)?.address;
}
