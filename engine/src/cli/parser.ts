import { isIp, maskToPrefix, parseVlanList } from "../ip.js";
import { parseIfName } from "./ifname.js";

/**
 * A small IOS-style command parser. Commands are declared as token patterns
 * ("show ip route", "ip address <ip:addr> <mask:mask>"); keywords may be abbreviated
 * to any unique prefix, `?` lists what can follow, and errors use the IOS wording.
 */

export type ParamKind = "ip" | "mask" | "wildcard" | "word" | "line" | "num" | "iface" | "vlans";

export type Token =
  | { kind: "kw"; word: string; help: string }
  | { kind: "param"; type: ParamKind; name: string; help: string; min?: number; max?: number };

export interface CommandDef<Ctx> {
  tokens: Token[];
  /** Allow the `no` form (handler receives negate = true). */
  negatable?: boolean;
  /** Only the `no` form exists (for example "no shutdown" is the normal form of shutdown). */
  run: (ctx: Ctx, args: Record<string, string>, negate: boolean) => void;
}

const PARAM_HELP: Record<ParamKind, string> = {
  ip: "A.B.C.D",
  mask: "A.B.C.D",
  wildcard: "A.B.C.D",
  word: "WORD",
  line: "LINE",
  num: "<num>",
  iface: "Interface",
  vlans: "WORD",
};

/**
 * Pattern syntax: words are keywords; <type:name> is a parameter, <num:name:1-4094> a
 * number range. Keyword help comes from `help`, keyed by the keyword.
 */
export function pattern(text: string, help: Record<string, string>, paramHelp: Record<string, string> = {}): Token[] {
  return text.split(/\s+/).map((w) => {
    const m = /^<(\w+):(\w+)(?::(\d+)-(\d+))?>$/.exec(w);
    if (!m) return { kind: "kw" as const, word: w, help: help[w] ?? "" };
    const type = m[1] as ParamKind;
    return {
      kind: "param" as const,
      type,
      name: m[2]!,
      help: paramHelp[m[2]!] ?? "",
      min: m[3] === undefined ? undefined : Number(m[3]),
      max: m[4] === undefined ? undefined : Number(m[4]),
    };
  });
}

function paramOk(t: Extract<Token, { kind: "param" }>, w: string): boolean {
  switch (t.type) {
    case "ip":
    case "wildcard":
      return isIp(w);
    case "mask":
      return isIp(w) && maskToPrefix(w) !== null;
    case "word":
    case "line":
      return w.length > 0;
    case "num": {
      if (!/^\d+$/.test(w)) return false;
      const n = Number(w);
      return (t.min === undefined || n >= t.min) && (t.max === undefined || n <= t.max);
    }
    case "iface":
      return parseIfName(w) !== null;
    case "vlans":
      return parseVlanList(w) !== null;
  }
}

/** Splits a command line into words, keeping the character offset of each. */
export function tokenize(line: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ word: m[0], at: m.index });
  return out;
}

/** Joins "gi 0/1" into one interface word when the next word is a number. */
function mergeIfaceWords(words: { word: string; at: number }[], i: number): { word: string; used: number } {
  const w = words[i]!.word;
  const next = words[i + 1]?.word;
  if (/^[a-z-]+$/i.test(w) && next && /^\d[\d/.]*$/.test(next) && parseIfName(`${w}${next}`)) return { word: `${w}${next}`, used: 2 };
  return { word: w, used: 1 };
}

export type MatchResult<Ctx> =
  | { ok: true; cmd: CommandDef<Ctx>; args: Record<string, string> }
  | { ok: false; error: "invalid"; at: number }
  | { ok: false; error: "ambiguous"; word: string }
  | { ok: false; error: "incomplete" };

interface Cand<Ctx> {
  cmd: CommandDef<Ctx>;
  args: Record<string, string>;
  /** Token index reached. */
  pos: number;
  /** Consumed by a LINE parameter: everything after belongs to it. */
  done: boolean;
  /** Number of words matched as parameters rather than keywords (lower is better). */
  params: number;
}

export function matchCommand<Ctx>(line: string, commands: CommandDef<Ctx>[]): MatchResult<Ctx> {
  const words = tokenize(line);
  let cands: Cand<Ctx>[] = commands.map((cmd) => ({ cmd, args: {}, pos: 0, done: false, params: 0 }));
  let i = 0;
  while (i < words.length) {
    const { word, at } = words[i]!;
    const lower = word.toLowerCase();
    // Keyword candidates at this position, to detect ambiguity.
    const kwHits = new Set<string>();
    let exact = false;
    for (const c of cands) {
      if (c.done) continue;
      const t = c.cmd.tokens[c.pos];
      if (t?.kind === "kw" && t.word.startsWith(lower)) {
        kwHits.add(t.word);
        if (t.word === lower) exact = true;
      }
    }
    const next: Cand<Ctx>[] = [];
    let advance = 1;
    for (const c of cands) {
      if (c.done) {
        next.push(c);
        continue;
      }
      const t = c.cmd.tokens[c.pos];
      if (!t) continue;
      if (t.kind === "kw") {
        if (!t.word.startsWith(lower)) continue;
        if (exact && t.word !== lower) continue;
        next.push({ ...c, pos: c.pos + 1 });
      } else if (t.type === "line") {
        next.push({ ...c, args: { ...c.args, [t.name]: line.slice(at).trim() }, pos: c.pos + 1, done: true, params: c.params + 1 });
      } else if (t.type === "iface") {
        const merged = mergeIfaceWords(words, i);
        if (paramOk(t, merged.word)) {
          // Interface names can take two words; all candidates here advance together.
          advance = Math.max(advance, merged.used);
          next.push({ ...c, args: { ...c.args, [t.name]: merged.word }, pos: c.pos + 1, params: c.params + 1 });
        }
      } else if (paramOk(t, word)) {
        next.push({ ...c, args: { ...c.args, [t.name]: word }, pos: c.pos + 1, params: c.params + 1 });
      }
    }
    if (!next.length) return { ok: false, error: "invalid", at };
    const distinctKw = [...kwHits];
    if (!exact && distinctKw.length > 1 && next.every((c) => c.done || c.cmd.tokens[c.pos - 1]?.kind === "kw"))
      return { ok: false, error: "ambiguous", word };
    cands = next;
    i += advance;
    if (cands.every((c) => c.done)) break;
  }
  const complete = cands.filter((c) => c.done || c.pos === c.cmd.tokens.length);
  if (!complete.length) return { ok: false, error: "incomplete" };
  complete.sort((a, b) => a.params - b.params);
  return { ok: true, cmd: complete[0]!.cmd, args: complete[0]!.args };
}

/** Help for `?`: what may follow the given (partial) line. Null when nothing matches. */
export function helpFor<Ctx>(line: string, commands: CommandDef<Ctx>[]): { word: string; help: string }[] | null {
  const endsWithSpace = line === "" || /\s$/.test(line);
  const words = tokenize(line);
  const partial = endsWithSpace ? "" : (words.pop()?.word ?? "");
  const prefix = words.map((w) => w.word).join(" ");
  const out = new Map<string, string>();
  let any = false;
  for (const c of commands) {
    const n = prefix ? countTokens(prefix, c) : 0;
    if (n < 0) continue;
    if (n > 0 && !matchCommand(prefix, [{ ...c, tokens: c.tokens.slice(0, n) }]).ok) continue;
    if (n >= c.tokens.length) {
      any = true;
      if (!partial) out.set("<cr>", "");
      continue;
    }
    const tok = c.tokens[n]!;
    if (tok.kind === "kw") {
      if (tok.word.startsWith(partial.toLowerCase())) {
        out.set(tok.word, tok.help);
        any = true;
      }
    } else if (!partial) {
      out.set(PARAM_HELP[tok.type], tok.help);
      any = true;
    }
  }
  if (!any) return null;
  return [...out].map(([word, help]) => ({ word, help })).sort((a, b) => (a.word === "<cr>" ? 1 : b.word === "<cr>" ? -1 : a.word.localeCompare(b.word)));
}

/** How many tokens of `c` the words of `prefix` cover (interface names may take two words). */
function countTokens<Ctx>(prefix: string, c: CommandDef<Ctx>): number {
  const words = tokenize(prefix);
  let n = 0;
  let i = 0;
  while (i < words.length && n < c.tokens.length) {
    const t = c.tokens[n]!;
    if (t.kind === "param" && t.type === "line") return c.tokens.length;
    if (t.kind === "param" && t.type === "iface") i += mergeIfaceWords(words, i).used;
    else i++;
    n++;
  }
  return i < words.length ? -1 : n;
}

/** Tab completion of the last word, when it is an unambiguous keyword. */
export function complete<Ctx>(line: string, commands: CommandDef<Ctx>[]): string | null {
  if (/\s$/.test(line) || !line.trim()) return null;
  const h = helpFor(line, commands);
  const kws = (h ?? []).filter((x) => !/^[<A-Z]/.test(x.word));
  if (kws.length !== 1) return null;
  const words = tokenize(line);
  const last = words[words.length - 1]!;
  return line.slice(0, last.at) + kws[0]!.word + " ";
}

