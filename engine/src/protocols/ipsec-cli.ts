import { formatIp, parseIp } from "../ip.js";
import type { AddressMatch } from "../model.js";
import { registerCliExtension } from "../cli/extensions.js";
import { pattern, type CommandDef } from "../cli/parser.js";
import type { Ctx } from "../cli/ios.js";
import { formatRule } from "../cli/show.js";
import {
  DEFAULT_POLICY,
  emptyIpsec,
  ENCRYPTION_TEXT,
  GROUP_BITS,
  HASH_TEXT,
  IPSEC,
  ipsecConfig,
  type CryptoMapEntry,
  type IpsecConfig,
  type IsakmpPolicy,
  type Tunnel,
  type TunnelProblem,
  tunnelKey,
} from "./ipsec.js";

/** IOS commands for site-to-site IPsec: `crypto isakmp`, `crypto ipsec transform-set`, `crypto map` and their show commands. */

const H: Record<string, string> = {
  crypto: "Encryption module",
  isakmp: "Configure ISAKMP policy / Internet Security Association and Key Management Protocol",
  ipsec: "Configure IPSEC policy",
  policy: "Set policy for an ISAKMP protection suite",
  key: "Set pre-shared key for remote peer",
  address: "define shared key with IP address / Match address of packets to encrypt",
  "transform-set": "Define transform and settings / Specify list of transform sets in priority order",
  map: "Enter a crypto map",
  "ipsec-isakmp": "IPSEC w/ISAKMP",
  encryption: "Set encryption algorithm for protection suite",
  des: "DES - Data Encryption Standard (56 bit keys).",
  "3des": "Three key triple DES",
  aes: "AES - Advanced Encryption Standard.",
  "128": "128 bit keys.",
  "192": "192 bit keys.",
  "256": "256 bit keys.",
  hash: "Set hash function for protection suite",
  md5: "Message Digest 5",
  sha: "Secure Hash Standard",
  sha256: "Secure Hash Standard 2 (256 bit)",
  sha384: "Secure Hash Standard 2 (384 bit)",
  sha512: "Secure Hash Standard 2 (512 bit)",
  authentication: "Set authentication method for protection suite",
  "pre-share": "Pre-Shared Key",
  "rsa-sig": "Rivest-Shamir-Adleman Signature",
  group: "Set the Diffie-Hellman group",
  lifetime: "Set lifetime for ISAKMP security association",
  mode: "encapsulation mode (transport/tunnel)",
  tunnel: "tunnel (datagram encapsulation) mode",
  transport: "transport (payload encapsulation) mode",
  set: "Set values for encryption/decryption",
  peer: "Allowed Encryption/Decryption peer",
  pfs: "Specify pfs settings",
  match: "Match values",
  description: "Description of the crypto map statement policy",
  show: "Show running system information",
  sa: "Crypto SAs / Security association",
  session: "Show crypto session information",
  clear: "Reset functions",
  exit: "Exit from crypto configuration mode",
  end: "Exit from configure mode",
};

const PH: Record<string, string> = {
  prio: "Priority of protection suite",
  key: "pre-shared key",
  addr: "define shared key with IP address / IP address of peer",
  mask: "Peer address mask",
  name: "Transform set tag / Crypto map tag",
  rest: "Transforms: esp-aes [128|192|256], esp-3des, esp-des, esp-null, esp-sha-hmac, esp-sha256-hmac ...",
  seq: "Sequence to insert into crypto map entry",
  g: "Diffie-Hellman group",
  s: "lifetime in seconds",
  acl: "IP access-list number or name",
  names: "Proposal tag",
  text: "Up to 80 characters describing this entry",
};

const cmd = (p: string, run: CommandDef<Ctx>["run"], negatable = false): CommandDef<Ctx> => ({ tokens: pattern(p, H, PH), run, negatable });
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function load(c: Ctx): IpsecConfig {
  return ipsecConfig(c.d) ?? emptyIpsec();
}

function save(c: Ctx, cfg: IpsecConfig) {
  const empty = !cfg.policies.length && !cfg.keys.length && !cfg.transformSets.length && !cfg.maps.length && !Object.keys(cfg.interfaces).length;
  if (empty) delete c.d.protocols[IPSEC];
  else c.d.protocols[IPSEC] = cfg;
  c.dirty = true;
}

function routerOnly(c: Ctx): boolean {
  if (c.d.kind === "router") return true;
  c.out.push("% IPsec needs a router in the simulator.");
  return false;
}

const ENCRYPTIONS = ["esp-des", "esp-3des", "esp-aes", "esp-null"];
const AUTHS = ["esp-md5-hmac", "esp-sha-hmac", "esp-sha256-hmac", "esp-sha384-hmac", "esp-sha512-hmac"];

/** "esp-aes 256 esp-sha-hmac" -> ["esp-aes 256", "esp-sha-hmac"], or an error. */
export function parseTransforms(text: string): string[] | string {
  const w = text.trim().toLowerCase().split(/\s+/);
  const out: string[] = [];
  let enc = 0;
  let auth = 0;
  for (let i = 0; i < w.length; i++) {
    const t = w[i]!;
    if (ENCRYPTIONS.includes(t)) {
      enc++;
      if (t === "esp-aes" && ["128", "192", "256"].includes(w[i + 1] ?? "")) {
        const bits = w[++i]!;
        out.push(bits === "128" ? "esp-aes" : `esp-aes ${bits}`);
      } else out.push(t);
    } else if (AUTHS.includes(t)) {
      auth++;
      out.push(t);
    } else return `% Invalid transform '${t}'. Use for example: esp-aes 256 esp-sha-hmac`;
  }
  if (!out.length || enc > 1 || auth > 1) return "% Use at most one encryption and one authentication transform.";
  return out;
}

const config: CommandDef<Ctx>[] = [
  cmd(
    "crypto isakmp policy <num:prio:1-10000>",
    (c, a, negate) => {
      const prio = Number(a.prio);
      const cfg = load(c);
      if (negate) {
        cfg.policies = cfg.policies.filter((p) => p.priority !== prio);
        return save(c, cfg);
      }
      if (!routerOnly(c)) return;
      if (!cfg.policies.some((p) => p.priority === prio)) cfg.policies.push({ priority: prio, ...DEFAULT_POLICY });
      save(c, cfg);
      c.s.ctx.seq = prio;
      c.s.mode = "isakmp-policy";
    },
    true,
  ),
  ...["", " <mask:mask>"].map((suffix) =>
    cmd(
      `crypto isakmp key <word:key> address <ip:addr>${suffix}`,
      (c, a, negate) => {
        const cfg = load(c);
        cfg.keys = cfg.keys.filter((k) => k.address !== a.addr);
        if (!negate) {
          if (!routerOnly(c)) return;
          if (a.key!.length > 128) return void c.out.push("% Key too long (max 128 characters).");
          cfg.keys.push({ key: a.key!, address: a.addr! });
        }
        save(c, cfg);
      },
      true,
    ),
  ),
  cmd(
    "crypto ipsec transform-set <word:name> <line:rest>",
    (c, a) => {
      if (!routerOnly(c)) return;
      const t = parseTransforms(a.rest!);
      if (typeof t === "string") return void c.out.push(t);
      const cfg = load(c);
      const cur = cfg.transformSets.find((x) => x.name === a.name);
      if (cur) cur.transforms = t;
      else cfg.transformSets.push({ name: a.name!, transforms: t, mode: "tunnel" });
      save(c, cfg);
      c.s.ctx.name = a.name;
      c.s.mode = "crypto-trans";
    },
  ),
  cmd(
    "crypto ipsec transform-set <word:name>",
    (c, a, negate) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      const cfg = load(c);
      cfg.transformSets = cfg.transformSets.filter((x) => x.name !== a.name);
      save(c, cfg);
    },
    true,
  ),
  ...["", " ipsec-isakmp"].map((suffix) =>
    cmd(
      `crypto map <word:name> <num:seq:1-65535>${suffix}`,
      (c, a, negate) => {
        const cfg = load(c);
        const seq = Number(a.seq);
        const same = (m: CryptoMapEntry) => m.map === a.name && m.seq === seq;
        if (negate) {
          cfg.maps = cfg.maps.filter((m) => !same(m));
          return save(c, cfg);
        }
        if (!routerOnly(c)) return;
        if (!cfg.maps.some(same)) {
          cfg.maps.push({ map: a.name!, seq, transformSets: [] });
          c.out.push("% NOTE: This new crypto map will remain disabled until a peer", "        and a valid access list have been configured.");
        }
        save(c, cfg);
        c.s.ctx.name = a.name;
        c.s.ctx.seq = seq;
        c.s.mode = "crypto-map";
      },
      true,
    ),
  ),
  cmd(
    "crypto map <word:name>",
    (c, a, negate) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      const cfg = load(c);
      cfg.maps = cfg.maps.filter((m) => m.map !== a.name);
      for (const [id, m] of Object.entries(cfg.interfaces)) if (m === a.name) delete cfg.interfaces[id];
      save(c, cfg);
    },
    true,
  ),
];

const leave = [cmd("exit", (c) => (c.s.mode = "config")), cmd("end", (c) => (c.s.mode = "priv"))];

function withPolicy(fn: (p: IsakmpPolicy, a: Record<string, string>, negate: boolean, c: Ctx) => void): CommandDef<Ctx>["run"] {
  return (c, a, negate) => {
    const cfg = load(c);
    const p = cfg.policies.find((x) => x.priority === c.s.ctx.seq);
    if (!p) return void (c.s.mode = "config");
    fn(p, a, negate, c);
    save(c, cfg);
  };
}

const policyMode: CommandDef<Ctx>[] = [
  ...[["des"], ["3des"], ["aes"], ["aes", "128"], ["aes", "192"], ["aes", "256"]].map((w) =>
    cmd(
      `encryption ${w.join(" ")}`,
      withPolicy((p, _a, negate) => {
        p.encryption = negate ? DEFAULT_POLICY.encryption : w[1] && w[1] !== "128" ? `aes ${w[1]}` : w[0]!;
      }),
      true,
    ),
  ),
  ...["md5", "sha", "sha256", "sha384", "sha512"].map((h) =>
    cmd(
      `hash ${h}`,
      withPolicy((p, _a, negate) => void (p.hash = negate ? DEFAULT_POLICY.hash : h)),
      true,
    ),
  ),
  ...(["pre-share", "rsa-sig"] as const).map((m) =>
    cmd(
      `authentication ${m}`,
      withPolicy((p, _a, negate) => void (p.authentication = negate ? DEFAULT_POLICY.authentication : m)),
      true,
    ),
  ),
  cmd(
    "group <num:g:1-24>",
    withPolicy((p, a, negate, c) => {
      const g = Number(a.g);
      if (!negate && !GROUP_BITS[g]) return void c.out.push(`% Diffie-Hellman group ${g} is not supported. Use 1, 2, 5, 14, 15, 16, 19, 20, 21 or 24.`);
      p.group = negate ? DEFAULT_POLICY.group : g;
    }),
    true,
  ),
  cmd(
    "lifetime <num:s:60-86400>",
    withPolicy((p, a, negate) => void (p.lifetime = negate ? DEFAULT_POLICY.lifetime : Number(a.s))),
    true,
  ),
  ...leave,
];

const transMode: CommandDef<Ctx>[] = [
  ...(["tunnel", "transport"] as const).map((m) =>
    cmd(
      `mode ${m}`,
      (c, _a, negate) => {
        const cfg = load(c);
        const t = cfg.transformSets.find((x) => x.name === c.s.ctx.name);
        if (!t) return void (c.s.mode = "config");
        t.mode = negate ? "tunnel" : m;
        save(c, cfg);
      },
      true,
    ),
  ),
  ...leave,
];

function withEntry(fn: (e: CryptoMapEntry, a: Record<string, string>, negate: boolean, c: Ctx) => void): CommandDef<Ctx>["run"] {
  return (c, a, negate) => {
    const cfg = load(c);
    const e = cfg.maps.find((m) => m.map === c.s.ctx.name && m.seq === c.s.ctx.seq);
    if (!e) return void (c.s.mode = "config");
    fn(e, a, negate, c);
    save(c, cfg);
  };
}

const mapMode: CommandDef<Ctx>[] = [
  cmd(
    "set peer <ip:addr>",
    withEntry((e, a, negate) => {
      if (negate) delete e.peer;
      else e.peer = a.addr;
    }),
    true,
  ),
  cmd(
    "set transform-set <line:names>",
    withEntry((e, a, negate, c) => {
      const names = a.names!.trim().split(/\s+/);
      if (names.length > 6) return void c.out.push("% At most 6 transform sets.");
      e.transformSets = negate ? e.transformSets.filter((n) => !names.includes(n)) : names;
      const missing = names.filter((n) => !load(c).transformSets.some((t) => t.name === n));
      if (!negate && missing.length) c.out.push(`% Transform set ${missing[0]} does not exist.`);
    }),
    true,
  ),
  cmd(
    "set transform-set",
    withEntry((e, _a, negate, c) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      e.transformSets = [];
    }),
    true,
  ),
  cmd(
    "match address <word:acl>",
    withEntry((e, a, negate) => {
      if (negate) delete e.acl;
      else e.acl = a.acl;
    }),
    true,
  ),
  cmd(
    "match address",
    withEntry((e, _a, negate, c) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      delete e.acl;
    }),
    true,
  ),
  ...[1, 2, 5, 14, 15, 16, 19, 20, 21, 24].map((g) =>
    cmd(
      `set pfs group${g}`,
      withEntry((e, _a, negate) => {
        if (negate) delete e.pfs;
        else e.pfs = g;
      }),
      true,
    ),
  ),
  cmd(
    "set pfs",
    withEntry((e, _a, negate) => {
      if (negate) delete e.pfs;
      else e.pfs = 1;
    }),
    true,
  ),
  cmd("description <line:text>", () => {}, true),
  ...leave,
];

const iface: CommandDef<Ctx>[] = [
  cmd(
    "crypto map <word:name>",
    (c, a, negate) => {
      if (!negate && !routerOnly(c)) return;
      const cfg = load(c);
      for (const id of c.s.ctx.ifaces) {
        if (negate) delete cfg.interfaces[id];
        else cfg.interfaces[id] = a.name!;
      }
      if (!negate && !cfg.maps.some((m) => m.map === a.name)) c.out.push(`% Crypto map ${a.name} does not exist yet; it is applied once you create it.`);
      save(c, cfg);
    },
    true,
  ),
  cmd(
    "crypto map",
    (c, _a, negate) => {
      if (!negate) return void c.out.push("% Incomplete command.");
      const cfg = load(c);
      for (const id of c.s.ctx.ifaces) delete cfg.interfaces[id];
      save(c, cfg);
    },
    true,
  ),
];

// ---------------------------------------------------------------- show commands

/** Why a tunnel is down, as a teaching aid. */
export const TUNNEL_PROBLEM_TEXT: Record<TunnelProblem, string> = {
  incomplete: "crypto map entry is incomplete (needs set peer, set transform-set and match address)",
  unreachable: "no route to the peer",
  noPeer: "the peer address has no crypto map applied",
  peerMismatch: "the peer has no crypto map entry pointing back to this router",
  filtered: "an access list blocks IKE (UDP 500) or ESP between the peers",
  isakmpPolicy: "no matching ISAKMP policy (encryption, hash, authentication, group)",
  noCertificate: "the ISAKMP policy uses rsa-sig, but no certificates are configured",
  key: "pre-shared keys do not match (or one is missing)",
  transform: "no matching transform set (or PFS group differs)",
  acl: "crypto access lists are not mirror images of each other",
};

const myTunnels = (c: Ctx): Tunnel[] => c.sim.tunnels.filter((t) => t.device.id === c.d.id);

function showIsakmpSa(c: Ctx) {
  c.out.push("IPv4 Crypto ISAKMP SA", `${pad("dst", 16)}${pad("src", 16)}${pad("state", 15)}${pad("conn-id", 8)}status`);
  let id = 1001;
  for (const t of myTunnels(c)) {
    if (t.peer === undefined || !t.remote || ["incomplete", "unreachable", "noPeer", "peerMismatch", "filtered"].includes(t.problem ?? "")) continue;
    const up = t.phase >= 1;
    c.out.push(`${pad(formatIp(t.peer), 16)}${pad(formatIp(t.local), 16)}${pad(up ? "QM_IDLE" : "MM_NO_STATE", 15)}${pad(id++, 8)}${up ? "ACTIVE" : "ACTIVE (deleted)"}`);
  }
  c.out.push("", "IPv6 Crypto ISAKMP SA", "");
}

function showIsakmpPolicy(c: Ctx) {
  const cfg = ipsecConfig(c.d);
  const suite = (p: Omit<IsakmpPolicy, "priority">) => [
    `\tencryption algorithm:\t${ENCRYPTION_TEXT[p.encryption] ?? p.encryption}`,
    `\thash algorithm:\t\t${HASH_TEXT[p.hash] ?? p.hash}`,
    `\tauthentication method:\t${p.authentication === "pre-share" ? "Pre-Shared Key" : "Rivest-Shamir-Adleman Signature"}`,
    `\tDiffie-Hellman group:\t#${p.group} (${GROUP_BITS[p.group] ?? "?"})`,
    `\tlifetime:\t\t${p.lifetime} seconds, no volume limit`,
  ];
  c.out.push("", "Global IKE policy");
  for (const p of cfg?.policies ?? []) c.out.push(`Protection suite of priority ${p.priority}`, ...suite(p));
  c.out.push("Default protection suite", ...suite(DEFAULT_POLICY));
}

function ident(m: AddressMatch): string {
  const mask = (~parseIp(m.wildcard)! >>> 0) >>> 0;
  return `${m.address}/${formatIp(mask)}`;
}

const PROTO_NO: Record<string, number> = { ip: 0, icmp: 1, tcp: 6, udp: 17, esp: 50 };

function showIpsecSa(c: Ctx) {
  const tunnels = myTunnels(c);
  if (!tunnels.length) return void c.out.push("", "No SAs found", "");
  const byIface = new Map<string, Tunnel[]>();
  for (const t of tunnels) byIface.set(t.iface.id, [...(byIface.get(t.iface.id) ?? []), t]);
  for (const list of byIface.values()) {
    const first = list[0]!;
    c.out.push("", `interface: ${first.iface.name}`, `    Crypto map tag: ${first.entry.map}, local addr ${formatIp(first.local)}`, "");
    for (const t of list) {
      const rules = t.acl?.rules.filter((r) => r.action === "permit") ?? [];
      const counters = c.sim.ipsecCounters.get(tunnelKey(t)) ?? { encaps: 0, decaps: 0 };
      for (const r of rules.length ? rules : [undefined]) {
        c.out.push("   protected vrf: (none)");
        if (r) {
          const p = PROTO_NO[r.protocol] ?? 0;
          c.out.push(`   local  ident (addr/mask/prot/port): (${ident(r.src)}/${p}/0)`, `   remote ident (addr/mask/prot/port): (${ident(r.dst)}/${p}/0)`);
        }
        c.out.push(`   current_peer ${t.entry.peer ?? "0.0.0.0"} port 500`, "     PERMIT, flags={origin_is_acl,}");
        const enc = t.phase === 2 ? counters.encaps : 0;
        const dec = t.phase === 2 ? counters.decaps : 0;
        c.out.push(`    #pkts encaps: ${enc}, #pkts encrypt: ${enc}, #pkts digest: ${enc}`, `    #pkts decaps: ${dec}, #pkts decrypt: ${dec}, #pkts verify: ${dec}`, "");
        c.out.push(`     local crypto endpt.: ${formatIp(t.local)}, remote crypto endpt.: ${t.entry.peer ?? "0.0.0.0"}`);
        c.out.push(`     current outbound spi: 0x${t.phase === 2 ? t.spiOut.toString(16).toUpperCase() : "0"}(${t.phase === 2 ? t.spiOut : 0})`, "");
        const sa = (dir: string, spi: number) => {
          c.out.push(`     ${dir} esp sas:`);
          if (t.phase !== 2) return;
          c.out.push(
            `      spi: 0x${spi.toString(16).toUpperCase()}(${spi})`,
            `        transform: ${t.transformSet!.transforms.join(" ")} ,`,
            `        in use settings ={${t.transformSet!.mode === "tunnel" ? "Tunnel" : "Transport"}, }`,
            `        sa timing: remaining key lifetime (k/sec): (4608000/3600)`,
            "        status: ACTIVE",
          );
        };
        sa("inbound", t.spiIn);
        sa("outbound", t.spiOut);
        if (t.problem) c.out.push("", `     ! Simulator: tunnel is down: ${TUNNEL_PROBLEM_TEXT[t.problem]}.`);
        c.out.push("");
      }
    }
  }
}

function showTransformSets(c: Ctx) {
  for (const t of ipsecConfig(c.d)?.transformSets ?? []) {
    c.out.push(`Transform set ${t.name}: { ${t.transforms.join(" ")}  }`, `   will negotiate = { ${t.mode === "tunnel" ? "Tunnel" : "Transport"},  },`, "");
  }
}

function showCryptoMap(c: Ctx) {
  const cfg = ipsecConfig(c.d);
  if (!cfg) return;
  for (const m of cfg.maps) {
    c.out.push(`Crypto Map "${m.map}" ${m.seq} ipsec-isakmp`, `\tPeer = ${m.peer ?? "(none)"}`);
    const acl = m.acl ? c.d.acls.find((a) => a.name === m.acl) : undefined;
    if (m.acl) {
      c.out.push(`\tExtended IP access list ${m.acl}`);
      for (const r of acl?.rules ?? []) c.out.push(`\t    access-list ${m.acl} ${formatRule(r, false)}`);
    }
    const t = myTunnels(c).find((x) => x.entry.map === m.map && x.entry.seq === m.seq);
    c.out.push(`\tCurrent peer: ${t?.phase === 2 ? m.peer : "(none)"}`, "\tSecurity association lifetime: 4608000 kilobytes/3600 seconds", `\tPFS (Y/N): ${m.pfs ? `Y\n\tDH group:  group${m.pfs}` : "N"}`);
    c.out.push("\tTransform sets={");
    for (const n of m.transformSets) {
      const ts = cfg.transformSets.find((x) => x.name === n);
      c.out.push(`\t\t${n}:  { ${ts ? ts.transforms.join(" ") : "(not defined)"} } ,`);
    }
    c.out.push("\t}");
    const ifs = Object.entries(cfg.interfaces).filter(([, name]) => name === m.map).map(([id]) => c.d.interfaces.find((i) => i.id === id)?.name).filter(Boolean);
    c.out.push(`\tInterfaces using crypto map ${m.map}:`, ...ifs.map((n) => `\t\t${n}`), "");
  }
}

function showSession(c: Ctx) {
  c.out.push("Crypto session current status", "");
  for (const t of myTunnels(c)) {
    const status = t.phase === 2 ? "UP-ACTIVE" : t.phase === 1 ? "UP-IDLE" : "DOWN";
    c.out.push(`Interface: ${t.iface.name}`, `Session status: ${status}`, `Peer: ${t.entry.peer ?? "(none)"} port 500`);
    if (t.phase >= 1) c.out.push(`  IKEv1 SA: local ${formatIp(t.local)}/500 remote ${t.entry.peer}/500 Active`);
    for (const r of t.acl?.rules.filter((x) => x.action === "permit") ?? []) {
      c.out.push(`  IPSEC FLOW: permit ${PROTO_NO[r.protocol] ?? 0} ${ident(r.src)} ${ident(r.dst)}`, `        Active SAs: ${t.phase === 2 ? 2 : 0}, origin: crypto map`);
    }
    if (t.problem) c.out.push(`  Simulator: ${TUNNEL_PROBLEM_TEXT[t.problem]}`);
    c.out.push("");
  }
}

const show: CommandDef<Ctx>[] = [
  cmd("show crypto isakmp sa", showIsakmpSa),
  cmd("show crypto isakmp policy", showIsakmpPolicy),
  cmd("show crypto ipsec sa", showIpsecSa),
  cmd("show crypto ipsec transform-set", showTransformSets),
  cmd("show crypto map", showCryptoMap),
  cmd("show crypto session", showSession),
  cmd("clear crypto sa", (c) => c.sim.clearIpsecCounters()),
  cmd("clear crypto isakmp", (c) => c.sim.clearIpsecCounters()),
];

registerCliExtension<Ctx>({
  commands(mode) {
    switch (mode) {
      case "priv":
        return show;
      case "config":
        return config;
      case "if":
      case "subif":
        return iface;
      case "isakmp-policy":
        return policyMode;
      case "crypto-trans":
        return transMode;
      case "crypto-map":
        return mapMode;
      default:
        return [];
    }
  },
  prompt: (mode) => ({ "isakmp-policy": "(config-isakmp)#", "crypto-trans": "(cfg-crypto-trans)#", "crypto-map": "(config-crypto-map)#" })[mode],
});
