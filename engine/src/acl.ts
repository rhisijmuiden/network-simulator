import { parseIp, wildcardMatch } from "./ip.js";
import type { Acl, AclRule, AddressMatch, Device, Interface, PortMatch } from "./model.js";
import type { Ipv4Packet } from "./packets.js";

export type Direction = "in" | "out";

export interface FilterVerdict {
  action: "permit" | "deny";
  /** Which filter decided, for example "acl". */
  filter: string;
  /** Human readable reference: ACL name and rule number. */
  rule?: string;
}

/**
 * Hook for L3/L4 filtering. The built-in ACL filter is one; a stateful firewall or IPsec
 * policy (later phases) registers another. Filters run in registration order; the first
 * deny wins.
 */
export interface PacketFilter {
  id: string;
  evaluate(ctx: { device: Device; iface: Interface; direction: Direction; packet: Ipv4Packet }): FilterVerdict | null;
}

const filters: PacketFilter[] = [];

export function registerPacketFilter(f: PacketFilter): void {
  const i = filters.findIndex((x) => x.id === f.id);
  if (i >= 0) filters[i] = f;
  else filters.push(f);
}

export function runFilters(ctx: Parameters<PacketFilter["evaluate"]>[0]): FilterVerdict | null {
  for (const f of filters) {
    const v = f.evaluate(ctx);
    if (v?.action === "deny") return v;
  }
  return null;
}

function addressMatches(m: AddressMatch, ip: number): boolean {
  const a = parseIp(m.address);
  const w = parseIp(m.wildcard);
  if (a === null || w === null) return false;
  return wildcardMatch(ip, a, w);
}

function portMatches(m: PortMatch | undefined, port: number | undefined): boolean {
  if (!m) return true;
  if (port === undefined) return false;
  switch (m.op) {
    case "eq":
      return port === m.from;
    case "neq":
      return port !== m.from;
    case "lt":
      return port < m.from;
    case "gt":
      return port > m.from;
    case "range":
      return port >= m.from && port <= (m.to ?? m.from);
  }
}

export function ruleMatches(rule: AclRule, p: Ipv4Packet): boolean {
  if (rule.protocol !== "ip" && rule.protocol !== p.protocol) return false;
  if (!addressMatches(rule.src, p.src) || !addressMatches(rule.dst, p.dst)) return false;
  const l4 = p.tcp ?? p.udp;
  if (rule.srcPort && !portMatches(rule.srcPort, l4?.srcPort)) return false;
  if (rule.dstPort && !portMatches(rule.dstPort, l4?.dstPort)) return false;
  return true;
}

/** First matching rule decides; no match is the implicit deny at the end of every ACL. */
export function evaluateAcl(acl: Acl, p: Ipv4Packet): { action: "permit" | "deny"; index: number } {
  const index = acl.rules.findIndex((r) => ruleMatches(r, p));
  if (index < 0) return { action: "deny", index: -1 };
  return { action: acl.rules[index]!.action, index };
}

registerPacketFilter({
  id: "acl",
  evaluate({ device, iface, direction, packet }) {
    const name = direction === "in" ? iface.aclIn : iface.aclOut;
    if (!name) return null;
    const acl = device.acls.find((a) => a.name === name);
    // Cisco: an ACL that is applied but not defined permits everything.
    if (!acl) return null;
    const r = evaluateAcl(acl, packet);
    return { action: r.action, filter: "acl", rule: r.index < 0 ? `${name} (implicit deny)` : `${name} #${(r.index + 1) * 10}` };
  },
});
