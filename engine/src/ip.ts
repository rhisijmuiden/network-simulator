/** IPv4 helpers. Addresses are handled as unsigned 32-bit numbers internally. */

export function parseIp(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function isIp(text: string): boolean {
  return parseIp(text) !== null;
}

export function formatIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function prefixMask(prefix: number): number {
  return prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToPrefix(mask: string): number | null {
  const m = parseIp(mask);
  if (m === null) return null;
  const prefix = 32 - Math.log2(((~m >>> 0) + 1) >>> 0 || 2 ** 32);
  return Number.isInteger(prefix) && prefixMask(prefix) === m ? prefix : null;
}

export function prefixToMask(prefix: number): string {
  return formatIp(prefixMask(prefix));
}

export function networkOf(ip: number, prefix: number): number {
  return (ip & prefixMask(prefix)) >>> 0;
}

export function inSubnet(ip: number, network: number, prefix: number): boolean {
  return networkOf(ip, prefix) === networkOf(network, prefix);
}

export function broadcastOf(ip: number, prefix: number): number {
  return (networkOf(ip, prefix) | (~prefixMask(prefix) >>> 0)) >>> 0;
}

/** Cisco wildcard match: bits set in the wildcard are "don't care". */
export function wildcardMatch(ip: number, address: number, wildcard: number): boolean {
  const care = ~wildcard >>> 0;
  return ((ip & care) >>> 0) === ((address & care) >>> 0);
}

/** "10.0.0.0/8" -> { network, prefix } */
export function parseCidr(text: string): { network: number; prefix: number } | null {
  const [a, p] = text.split("/");
  const ip = a === undefined ? null : parseIp(a);
  const prefix = Number(p);
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { network: networkOf(ip, prefix), prefix };
}

export function formatCidr(network: number, prefix: number): string {
  return `${formatIp(network)}/${prefix}`;
}

/** A host address that is valid on its subnet (not the network or broadcast address, except /31 and /32). */
export function isUsableHost(ip: number, prefix: number): boolean {
  if (prefix >= 31) return true;
  return ip !== networkOf(ip, prefix) && ip !== broadcastOf(ip, prefix);
}

/** Parses a VLAN list such as "1,10-20,99" or "all". */
export function parseVlanList(text: string): Set<number> | "all" | null {
  const s = text.trim().toLowerCase();
  if (s === "all" || s === "") return "all";
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to > 4094 || to < from) return null;
    for (let v = from; v <= to; v++) out.add(v);
  }
  return out;
}
