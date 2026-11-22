import { formatIp, networkOf, parseIp, parseVlanList, prefixMask, type AddressMatch, type PortMatch } from "@netsim/engine";
import { parseAddressInput } from "./ops";

/** Address with prefix for interfaces: "10.0.0.1/24" or "10.0.0.1 255.255.255.0"; empty clears it. */
export function parseIfaceAddress(text: string): { address: string; prefix: number } | null | undefined {
  const r = parseAddressInput(text);
  if (r === "empty") return null;
  return r ?? undefined;
}

export function formatIfaceAddress(ip?: { address: string; prefix: number }): string {
  return ip ? `${ip.address}/${ip.prefix}` : "";
}

/** Destination network for a route; the host bits are cleared ("10.1.2.3/16" -> 10.1.0.0/16). */
export function parseNetwork(text: string): { network: string; prefix: number } | undefined {
  const r = parseAddressInput(text, 32);
  if (!r || r === "empty") return undefined;
  return { network: formatIp(networkOf(parseIp(r.address)!, r.prefix)), prefix: r.prefix };
}

export function parseOptionalIp(text: string): string | null | undefined {
  const s = text.trim();
  if (!s) return null;
  return parseIp(s) === null ? undefined : s;
}

export function parseVlanId(text: string): number | undefined {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= 4094 ? n : undefined;
}

export function parseVlanListInput(text: string): string | undefined {
  const s = text.trim() || "all";
  return parseVlanList(s) === null ? undefined : s.toLowerCase();
}

export const ANY: AddressMatch = { address: "0.0.0.0", wildcard: "255.255.255.255" };

/** Cisco-style address match: "any", "host 10.0.0.1", "10.0.0.0 0.0.0.255" or "10.0.0.0/24". */
export function parseAddressMatch(text: string): AddressMatch | undefined {
  const s = text.trim().toLowerCase();
  if (s === "any" || s === "") return ANY;
  const host = /^host\s+(\S+)$/.exec(s);
  if (host) return parseIp(host[1]!) === null ? undefined : { address: host[1]!, wildcard: "0.0.0.0" };
  if (parseIp(s) !== null) return { address: s, wildcard: "0.0.0.0" };
  const cidr = /^(\S+)\/(\d{1,2})$/.exec(s);
  if (cidr) {
    const ip = parseIp(cidr[1]!);
    const p = Number(cidr[2]);
    if (ip === null || p > 32) return undefined;
    return { address: formatIp(networkOf(ip, p)), wildcard: formatIp(~prefixMask(p) >>> 0) };
  }
  const wc = /^(\S+)\s+(\S+)$/.exec(s);
  if (wc && parseIp(wc[1]!) !== null && parseIp(wc[2]!) !== null) return { address: wc[1]!, wildcard: wc[2]! };
  return undefined;
}

export function formatAddressMatch(m: AddressMatch): string {
  if (m.wildcard === "255.255.255.255") return "any";
  if (m.wildcard === "0.0.0.0") return `host ${m.address}`;
  return `${m.address} ${m.wildcard}`;
}

/** "eq 80", "gt 1023", "range 1000 2000", "80" (= eq 80) or empty for any port. */
export function parsePortMatch(text: string): PortMatch | null | undefined {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= 65535;
  if (/^\d+$/.test(s)) return valid(Number(s)) ? { op: "eq", from: Number(s) } : undefined;
  const range = /^range\s+(\d+)\s+(\d+)$/.exec(s);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    return valid(from) && valid(to) && from <= to ? { op: "range", from, to } : undefined;
  }
  const m = /^(eq|neq|lt|gt)\s+(\d+)$/.exec(s);
  if (m && valid(Number(m[2]))) return { op: m[1] as PortMatch["op"], from: Number(m[2]) };
  return undefined;
}

export function formatPortMatch(m?: PortMatch): string {
  if (!m) return "";
  return m.op === "range" ? `range ${m.from} ${m.to ?? m.from}` : `${m.op} ${m.from}`;
}

export function parsePortList(text: string): number[] | undefined {
  const s = text.trim();
  if (!s) return [];
  const out: number[] = [];
  for (const p of s.split(/[\s,]+/)) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return undefined;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}
