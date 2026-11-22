import type { Device, Interface } from "../model.js";

/** Interface type keywords as typed on a Cisco-style CLI, with the full name they expand to. */
const TYPES: [string, string][] = [
  ["tengigabitethernet", "TenGigabitEthernet"],
  ["gigabitethernet", "GigabitEthernet"],
  ["fastethernet", "FastEthernet"],
  ["ethernet", "Ethernet"],
  ["loopback", "Loopback"],
  ["vlan", "Vlan"],
  ["port-channel", "Port-channel"],
];

/** Short forms that are not plain prefixes. */
const ALIASES: Record<string, string> = { te: "tengigabitethernet", gi: "gigabitethernet", g: "gigabitethernet", fa: "fastethernet", f: "fastethernet", lo: "loopback", eth: "ethernet", e: "ethernet" };

export interface ParsedIfName {
  type: string;
  /** Number part such as 0/1, 1/0/24, 10 or 0/0.20 */
  number: string;
  full: string;
}

/**
 * Parses names such as "g0/1", "Gig 0/1", "fa0/1", "te1/1/1", "vlan 10", "lo0", "g0/0.10".
 * The name may be split over two words ("gigabitEthernet 0/1").
 */
export function parseIfName(text: string): ParsedIfName | null {
  const m = /^([a-z-]+)\s*([0-9][0-9/.]*)$/i.exec(text.trim());
  if (!m) return null;
  const word = m[1]!.toLowerCase();
  const number = m[2]!;
  if (!/^\d+(\/\d+)*(\.\d+)?$/.test(number)) return null;
  const key = ALIASES[word] ?? word;
  // Prefix match on the type, but "te" must not be read as "tengig" vs ... ambiguity: pick the first match in TYPES order.
  const hit = TYPES.find(([k]) => k === key) ?? TYPES.find(([k]) => k.startsWith(key));
  if (!hit) return null;
  return { type: hit[1], number, full: `${hit[1]}${number}` };
}

export function findIface(device: Device, text: string): Interface | undefined {
  const p = parseIfName(text);
  if (!p) return undefined;
  return device.interfaces.find((i) => i.name.toLowerCase() === p.full.toLowerCase());
}

/** "fa0/1 - 5" or "gi1/0/1-4, gi1/0/10": interface range syntax. */
export function parseIfRange(device: Device, text: string): Interface[] | null {
  const out: Interface[] = [];
  for (const part of text.split(",")) {
    const m = /^\s*([a-z-]+\s*[0-9/]*?)(\d+)\s*(?:-\s*(\d+))?\s*$/i.exec(part);
    if (!m) return null;
    const from = Number(m[2]);
    const to = m[3] === undefined ? from : Number(m[3]);
    if (to < from) return null;
    for (let n = from; n <= to; n++) {
      const i = findIface(device, `${m[1]}${n}`);
      if (!i) return null;
      if (!out.includes(i)) out.push(i);
    }
  }
  return out.length ? out : null;
}

/** Cisco MAC notation: 0200.1234.abcd */
export function ciscoMac(mac: string): string {
  const h = mac.replace(/:/g, "");
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`;
}
