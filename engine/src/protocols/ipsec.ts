import { ruleMatches, runFilters } from "../acl.js";
import { formatIp, parseIp } from "../ip.js";
import type { Acl, AclRule, Device, Interface } from "../model.js";
import type { NetworkIndex } from "../network.js";
import type { Ipv4Packet } from "../packets.js";
import { registerRoutingProtocol, resolveRoute, type RouteEntry } from "../routing.js";

/**
 * Site-to-site IPsec with IKEv1 and crypto maps, the classic IOS configuration:
 * ISAKMP policies and pre-shared keys (phase 1), transform sets and crypto ACLs (phase 2),
 * and a crypto map applied to the outside interface.
 *
 * Like the routing protocols, tunnels are computed in their converged state: a tunnel is up
 * when both ends agree on everything and can reach each other. The simulator then
 * encapsulates matching traffic in ESP towards the peer and decapsulates it there.
 */

export const IPSEC = "ipsec";

export interface IsakmpPolicy {
  priority: number;
  /** des, 3des, aes, aes 192, aes 256 */
  encryption: string;
  /** md5, sha, sha256, sha384, sha512 */
  hash: string;
  authentication: "pre-share" | "rsa-sig";
  group: number;
  lifetime: number;
}

export interface IsakmpKey {
  key: string;
  /** Peer address; 0.0.0.0 matches every peer. */
  address: string;
}

export interface TransformSet {
  name: string;
  /** For example ["esp-aes 256", "esp-sha-hmac"]. */
  transforms: string[];
  mode: "tunnel" | "transport";
}

export interface CryptoMapEntry {
  map: string;
  seq: number;
  peer?: string;
  transformSets: string[];
  /** Crypto ACL: which traffic the entry protects. */
  acl?: string;
  /** Diffie-Hellman group for perfect forward secrecy. */
  pfs?: number;
}

export interface IpsecConfig {
  policies: IsakmpPolicy[];
  keys: IsakmpKey[];
  transformSets: TransformSet[];
  maps: CryptoMapEntry[];
  /** Interface id -> crypto map name. */
  interfaces: Record<string, string>;
}

/** IOS defaults for a new ISAKMP policy. */
export const DEFAULT_POLICY: Omit<IsakmpPolicy, "priority"> = { encryption: "des", hash: "sha", authentication: "rsa-sig", group: 1, lifetime: 86400 };

export function emptyIpsec(): IpsecConfig {
  return { policies: [], keys: [], transformSets: [], maps: [], interfaces: {} };
}

const arr = <T>(x: unknown, ok: (v: T) => boolean): T[] => (Array.isArray(x) ? (x as T[]).filter((v) => v && typeof v === "object" && ok(v)) : []);

export function ipsecConfig(d: Device): IpsecConfig | undefined {
  const c = d.protocols[IPSEC] as Partial<IpsecConfig> | undefined;
  if (!c || typeof c !== "object") return undefined;
  return {
    policies: arr<IsakmpPolicy>(c.policies, (p) => Number.isInteger(p.priority) && typeof p.encryption === "string" && typeof p.hash === "string").sort((a, b) => a.priority - b.priority),
    keys: arr<IsakmpKey>(c.keys, (k) => typeof k.key === "string" && parseIp(k.address) !== null),
    transformSets: arr<TransformSet>(c.transformSets, (t) => typeof t.name === "string" && Array.isArray(t.transforms)),
    maps: arr<CryptoMapEntry>(c.maps, (m) => typeof m.map === "string" && Number.isInteger(m.seq) && Array.isArray(m.transformSets)).sort((a, b) => a.map.localeCompare(b.map) || a.seq - b.seq),
    interfaces: c.interfaces && typeof c.interfaces === "object" ? { ...c.interfaces } : {},
  };
}

export type TunnelProblem =
  | "incomplete"
  | "unreachable"
  | "noPeer"
  | "peerMismatch"
  | "filtered"
  | "isakmpPolicy"
  | "noCertificate"
  | "key"
  | "transform"
  | "acl";

export interface Tunnel {
  device: Device;
  /** Interface the crypto map is applied to. */
  iface: Interface;
  entry: CryptoMapEntry;
  local: number;
  peer?: number;
  remote?: { device: Device; iface: Interface; entry: CryptoMapEntry };
  policy?: IsakmpPolicy;
  transformSet?: TransformSet;
  acl?: Acl;
  /** 0: nothing, 1: IKE (ISAKMP) SA up, 2: IPsec SAs up. */
  phase: 0 | 1 | 2;
  problem?: TunnelProblem;
  /** Outbound and inbound SPI (stable for a given pair of endpoints). */
  spiOut: number;
  spiIn: number;
}

const samePolicy = (a: IsakmpPolicy, b: IsakmpPolicy) => a.encryption === b.encryption && a.hash === b.hash && a.authentication === b.authentication && a.group === b.group;
const sameTransform = (a: TransformSet, b: TransformSet) => a.mode === b.mode && [...a.transforms].sort().join("|") === [...b.transforms].sort().join("|");

function keyFor(cfg: IpsecConfig, peer: number): IsakmpKey | undefined {
  return cfg.keys.find((k) => k.address === formatIp(peer)) ?? cfg.keys.find((k) => k.address === "0.0.0.0");
}

function spi(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h | 0x10000000) >>> 0;
}

const mirrored = (a: AclRule, b: AclRule) =>
  a.protocol === b.protocol && a.src.address === b.dst.address && a.src.wildcard === b.dst.wildcard && a.dst.address === b.src.address && a.dst.wildcard === b.src.wildcard;

/** True when the device's crypto interface lets IKE (UDP 500) and ESP from `from` in. */
function admits(device: Device, iface: Interface, from: number, to: number): boolean {
  const base = { kind: "ipv4" as const, src: from, dst: to, ttl: 255, flow: 0 };
  const ike: Ipv4Packet = { ...base, protocol: "udp", udp: { srcPort: 500, dstPort: 500 } };
  const esp: Ipv4Packet = { ...base, protocol: "esp", esp: { spi: 0, inner: { ...base, protocol: "icmp" } } };
  return [ike, esp].every((p) => !runFilters({ device, iface, direction: "in", packet: p }));
}

/** Every crypto map entry on an interface, with the state of its tunnel. */
export function ipsecTunnels(net: NetworkIndex, routes: Map<string, RouteEntry[]>): Tunnel[] {
  const out: Tunnel[] = [];
  const cfgs = new Map<string, IpsecConfig>();
  for (const d of net.devices.values()) {
    const c = ipsecConfig(d);
    if (c) cfgs.set(d.id, c);
  }
  const reachable = (d: Device, ip: number) => Boolean(resolveRoute(net, d, routes.get(d.id) ?? [], ip));
  for (const [id, cfg] of cfgs) {
    const device = net.devices.get(id)!;
    for (const [ifaceId, mapName] of Object.entries(cfg.interfaces)) {
      const iface = device.interfaces.find((i) => i.id === ifaceId);
      if (!iface?.ip || !net.isUp(iface)) continue;
      const local = parseIp(iface.ip.address)!;
      for (const entry of cfg.maps.filter((m) => m.map === mapName)) {
        const peer = entry.peer ? parseIp(entry.peer) ?? undefined : undefined;
        const acl = entry.acl ? device.acls.find((a) => a.name === entry.acl) : undefined;
        const sets = entry.transformSets.map((n) => cfg.transformSets.find((t) => t.name === n)).filter((t): t is TransformSet => Boolean(t));
        const t: Tunnel = { device, iface, entry, local, peer, acl, phase: 0, spiOut: spi(local, peer ?? 0), spiIn: spi(peer ?? 0, local) };
        out.push(t);
        const fail = (problem: TunnelProblem) => void (t.problem = problem);
        if (peer === undefined || !acl || !sets.length) {
          fail("incomplete");
          continue;
        }
        if (!reachable(device, peer)) {
          fail("unreachable");
          continue;
        }
        const owner = net.ownerOf(peer);
        const rcfg = owner && cfgs.get(owner.device.id);
        const rmap = rcfg && owner && net.isUp(owner.iface) ? rcfg.interfaces[owner.iface.id] : undefined;
        if (!owner || !rcfg || !rmap) {
          fail("noPeer");
          continue;
        }
        const rentry = rcfg.maps.find((m) => m.map === rmap && m.peer === formatIp(local));
        if (!rentry) {
          fail("peerMismatch");
          continue;
        }
        t.remote = { device: owner.device, iface: owner.iface, entry: rentry };
        if (!reachable(owner.device, local)) {
          fail("unreachable");
          continue;
        }
        if (!admits(owner.device, owner.iface, local, peer) || !admits(device, iface, peer, local)) {
          fail("filtered");
          continue;
        }
        // Phase 1: the first of our policies (by priority) that the peer also has.
        const policy = cfg.policies.find((p) => rcfg.policies.some((q) => samePolicy(p, q)));
        if (!policy) {
          fail("isakmpPolicy");
          continue;
        }
        t.policy = policy;
        if (policy.authentication === "rsa-sig") {
          fail("noCertificate");
          continue;
        }
        const mine = keyFor(cfg, peer);
        const theirs = keyFor(rcfg, local);
        if (!mine || !theirs || mine.key !== theirs.key) {
          fail("key");
          continue;
        }
        t.phase = 1;
        // Phase 2: a common transform set and mirrored crypto ACLs.
        const rsets = rentry.transformSets.map((n) => rcfg.transformSets.find((x) => x.name === n)).filter((x): x is TransformSet => Boolean(x));
        const ts = sets.find((s) => rsets.some((r) => sameTransform(s, r)));
        if (!ts || (entry.pfs ?? 0) !== (rentry.pfs ?? 0)) {
          fail("transform");
          continue;
        }
        t.transformSet = ts;
        const racl = rentry.acl ? owner.device.acls.find((a) => a.name === rentry.acl) : undefined;
        const permits = acl.rules.filter((r) => r.action === "permit");
        const rpermits = racl?.rules.filter((r) => r.action === "permit") ?? [];
        if (!permits.length || !permits.every((r) => rpermits.some((x) => mirrored(r, x))) || !rpermits.every((r) => permits.some((x) => mirrored(r, x)))) {
          fail("acl");
          continue;
        }
        t.phase = 2;
      }
    }
  }
  return out;
}

/** Identifies one end of a tunnel: device, crypto map and sequence number. */
export function tunnelKey(t: Tunnel): string {
  return `${t.device.id}|${t.entry.map}|${t.entry.seq}`;
}

/** The crypto map entry that protects a packet leaving `iface`, if any (first permit wins, deny skips the entry). */
export function protectingEntry(device: Device, iface: Interface, p: Ipv4Packet): CryptoMapEntry | undefined {
  const cfg = ipsecConfig(device);
  const name = cfg?.interfaces[iface.id];
  if (!cfg || !name) return undefined;
  for (const e of cfg.maps.filter((m) => m.map === name)) {
    const acl = e.acl ? device.acls.find((a) => a.name === e.acl) : undefined;
    const rule = acl?.rules.find((r) => ruleMatches(r, p));
    if (rule?.action === "permit") return e;
  }
  return undefined;
}

/** True when a plain packet arriving on `iface` should have come through the tunnel (it matches a crypto ACL mirrored). */
export function shouldHaveBeenEncrypted(device: Device, iface: Interface, p: Ipv4Packet): boolean {
  const swapped: Ipv4Packet = {
    ...p,
    src: p.dst,
    dst: p.src,
    tcp: p.tcp && { ...p.tcp, srcPort: p.tcp.dstPort, dstPort: p.tcp.srcPort },
    udp: p.udp && { ...p.udp, srcPort: p.udp.dstPort, dstPort: p.udp.srcPort },
  };
  return Boolean(protectingEntry(device, iface, swapped));
}

export const ENCRYPTION_TEXT: Record<string, string> = {
  des: "DES - Data Encryption Standard (56 bit keys).",
  "3des": "Three key triple DES",
  aes: "AES - Advanced Encryption Standard (128 bit keys).",
  "aes 192": "AES - Advanced Encryption Standard (192 bit keys).",
  "aes 256": "AES - Advanced Encryption Standard (256 bit keys).",
};

export const HASH_TEXT: Record<string, string> = {
  md5: "Message Digest 5",
  sha: "Secure Hash Standard",
  sha256: "Secure Hash Standard 2 (256 bit)",
  sha384: "Secure Hash Standard 2 (384 bit)",
  sha512: "Secure Hash Standard 2 (512 bit)",
};

export const GROUP_BITS: Record<number, string> = { 1: "768 bit", 2: "1024 bit", 5: "1536 bit", 14: "2048 bit", 15: "3072 bit", 16: "4096 bit", 19: "256 bit ecp", 20: "384 bit ecp", 21: "521 bit ecp", 24: "2048 bit, 256 bit subgroup" };

function runningConfig(cfg: IpsecConfig): string[] {
  const out: string[] = [];
  for (const p of cfg.policies) {
    out.push(`crypto isakmp policy ${p.priority}`);
    if (p.encryption !== DEFAULT_POLICY.encryption) out.push(` encr ${p.encryption}`);
    if (p.hash !== DEFAULT_POLICY.hash) out.push(` hash ${p.hash}`);
    if (p.authentication !== DEFAULT_POLICY.authentication) out.push(` authentication ${p.authentication}`);
    if (p.group !== DEFAULT_POLICY.group) out.push(` group ${p.group}`);
    if (p.lifetime !== DEFAULT_POLICY.lifetime) out.push(` lifetime ${p.lifetime}`);
  }
  for (const k of cfg.keys) out.push(`crypto isakmp key ${k.key} address ${k.address}${k.address === "0.0.0.0" ? " 0.0.0.0" : ""}`);
  if (cfg.policies.length || cfg.keys.length) out.push("!");
  for (const t of cfg.transformSets) {
    out.push(`crypto ipsec transform-set ${t.name} ${t.transforms.join(" ")}`, ` mode ${t.mode}`);
  }
  if (cfg.transformSets.length) out.push("!");
  for (const m of cfg.maps) {
    out.push(`crypto map ${m.map} ${m.seq} ipsec-isakmp`);
    if (m.peer) out.push(` set peer ${m.peer}`);
    if (m.transformSets.length) out.push(` set transform-set ${m.transformSets.join(" ")}`);
    if (m.pfs) out.push(` set pfs group${m.pfs}`);
    if (m.acl) out.push(` match address ${m.acl}`);
  }
  if (out[out.length - 1] === "!") out.pop();
  return out;
}

// Not a routing protocol, but this hook gives IPsec its place in `show running-config`.
registerRoutingProtocol({
  id: IPSEC,
  code: "",
  distance: 255,
  compute: () => new Map(),
  runningConfig: (_c, d) => {
    const cfg = ipsecConfig(d);
    return cfg ? runningConfig(cfg) : [];
  },
  interfaceConfig: (_c, d, i) => {
    const map = ipsecConfig(d)?.interfaces[i.id];
    return map ? [` crypto map ${map}`] : [];
  },
});
