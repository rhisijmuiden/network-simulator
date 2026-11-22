import { diagnose } from "./diagnostics.js";
import { formatIp, inSubnet, isIp, parseCidr } from "./ip.js";
import { isHost, type Topology } from "./model.js";
import { bgpState } from "./protocols/bgp.js";
import { ospfNeighbors } from "./protocols/ospf.js";
import { Simulator } from "./simulator.js";

/**
 * Lessons and troubleshooting assignments. A scenario is a start topology plus checks that
 * decide, against the student's current topology, whether the goal is met. Devices are
 * referred to by name, so checks keep working on the student's own copy.
 */

/** Text in one language (written by a teacher) or in both (built-in scenarios). */
export type LessonText = string | { en: string; nl: string };

export type Check =
  | { id: string; type: "ping"; from: string; to: string; expect: "reach" | "fail" }
  | { id: string; type: "tcp"; from: string; to: string; port: number; expect: "open" | "blocked" }
  | { id: string; type: "route"; device: string; network: string }
  | { id: string; type: "ospf"; device: string; neighbor: string }
  | { id: string; type: "bgp"; device: string; peer: string }
  | { id: string; type: "ipsec"; device: string }
  | { id: string; type: "dhcp"; device: string }
  | { id: string; type: "noErrors" };

export type CheckType = Check["type"];
export const CHECK_TYPES: CheckType[] = ["ping", "tcp", "route", "ospf", "bgp", "ipsec", "dhcp", "noErrors"];

export interface CheckResult {
  id: string;
  passed: boolean;
  /**
   * Why it failed, as a code the UI translates under `lessons.why.<code>`:
   * noDevice, noTarget, noReply, reached, closed, open, filtered, noRoute, noNeighbor,
   * notEstablished, tunnelDown, noLease, errors.
   */
  why?: string;
  /** Extra detail for `why`, for example the device name or the number of errors. */
  detail?: string;
}

const MAX_CHECKS = 30;

/** Validates check definitions from a teacher; returns the cleaned list or an error code. */
export function parseChecks(input: unknown): Check[] | string {
  if (!Array.isArray(input) || input.length > MAX_CHECKS) return "lessons.invalidChecks";
  const name = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 64;
  const out: Check[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return "lessons.invalidChecks";
    const c = raw as Record<string, unknown>;
    const id = typeof c.id === "string" && c.id.length <= 40 ? c.id : `c${out.length + 1}`;
    switch (c.type) {
      case "ping":
        if (!name(c.from) || !name(c.to) || (c.expect !== "reach" && c.expect !== "fail")) return "lessons.invalidChecks";
        out.push({ id, type: "ping", from: String(c.from).trim(), to: String(c.to).trim(), expect: c.expect });
        break;
      case "tcp":
        if (!name(c.from) || !name(c.to) || !Number.isInteger(c.port) || (c.port as number) < 1 || (c.port as number) > 65535 || (c.expect !== "open" && c.expect !== "blocked"))
          return "lessons.invalidChecks";
        out.push({ id, type: "tcp", from: String(c.from).trim(), to: String(c.to).trim(), port: c.port as number, expect: c.expect });
        break;
      case "route":
        if (!name(c.device) || typeof c.network !== "string" || !parseCidr(c.network)) return "lessons.invalidChecks";
        out.push({ id, type: "route", device: String(c.device).trim(), network: c.network.trim() });
        break;
      case "ospf":
        if (!name(c.device) || !name(c.neighbor)) return "lessons.invalidChecks";
        out.push({ id, type: "ospf", device: String(c.device).trim(), neighbor: String(c.neighbor).trim() });
        break;
      case "bgp":
        if (!name(c.device) || typeof c.peer !== "string" || !isIp(c.peer)) return "lessons.invalidChecks";
        out.push({ id, type: "bgp", device: String(c.device).trim(), peer: c.peer });
        break;
      case "ipsec":
      case "dhcp":
        if (!name(c.device)) return "lessons.invalidChecks";
        out.push({ id, type: c.type, device: String(c.device).trim() });
        break;
      case "noErrors":
        out.push({ id, type: "noErrors" });
        break;
      default:
        return "lessons.invalidChecks";
    }
  }
  return out;
}

/** Runs every check against a topology. */
export function evaluateChecks(topology: Topology, checks: Check[]): CheckResult[] {
  const sim = new Simulator(topology);
  const t = sim.topology;
  const byName = (n: string) => t.devices.find((d) => d.name.toLowerCase() === n.toLowerCase());
  /** An address, or the first address of a device with that name. */
  const address = (target: string): string | undefined => {
    if (isIp(target)) return target;
    return byName(target)?.interfaces.find((i) => i.ip)?.ip?.address;
  };
  return checks.map((c): CheckResult => {
    const fail = (why: string, detail?: string): CheckResult => ({ id: c.id, passed: false, why, detail });
    const ok: CheckResult = { id: c.id, passed: true };
    switch (c.type) {
      case "ping": {
        const from = byName(c.from);
        if (!from) return fail("noDevice", c.from);
        const to = address(c.to);
        if (!to) return fail("noTarget", c.to);
        const r = sim.ping(from.id, to, { count: 3 }).result;
        const reached = r.received > 0;
        if (c.expect === "reach") return reached ? ok : fail("noReply", to);
        return reached ? fail("reached", to) : ok;
      }
      case "tcp": {
        const from = byName(c.from);
        if (!from) return fail("noDevice", c.from);
        const to = address(c.to);
        if (!to) return fail("noTarget", c.to);
        const r = sim.tcpConnect(from.id, to, c.port).result;
        if (c.expect === "open") return r.status === "open" ? ok : fail(r.status === "closed" ? "closed" : r.status === "filtered" ? "filtered" : "noReply", `${to}:${c.port}`);
        // Blocked: filtered by an ACL or not answered at all; a closed port still reaches the server.
        return r.status === "filtered" || r.status === "unreachable" ? ok : fail(r.status === "open" ? "open" : "closed", `${to}:${c.port}`);
      }
      case "route": {
        const d = byName(c.device);
        if (!d) return fail("noDevice", c.device);
        const target = parseCidr(c.network)!;
        const has = sim.routingTable(d.id).some((r) => (r.network === target.network && r.prefix === target.prefix) || (r.prefix <= target.prefix && inSubnet(target.network, r.network, r.prefix) && r.prefix > 0));
        return has ? ok : fail("noRoute", `${formatIp(target.network)}/${target.prefix}`);
      }
      case "ospf": {
        const d = byName(c.device);
        const n = byName(c.neighbor);
        if (!d) return fail("noDevice", c.device);
        if (!n) return fail("noDevice", c.neighbor);
        return ospfNeighbors(sim.net, d).some((x) => x.device.id === n.id && !x.problem) ? ok : fail("noNeighbor", n.name);
      }
      case "bgp": {
        const d = byName(c.device);
        if (!d) return fail("noDevice", c.device);
        const s = bgpState(sim.net, sim.routes).sessions.find((x) => x.device.id === d.id && x.neighbor.address === c.peer);
        return s?.state === "Established" ? ok : fail("notEstablished", c.peer);
      }
      case "ipsec": {
        const d = byName(c.device);
        if (!d) return fail("noDevice", c.device);
        const mine = sim.tunnels.filter((x) => x.device.id === d.id);
        return mine.length && mine.every((x) => x.phase === 2) ? ok : fail("tunnelDown", d.name);
      }
      case "dhcp": {
        const d = byName(c.device);
        if (!d) return fail("noDevice", c.device);
        const nic = d.interfaces.find((i) => sim.leases.has(i.id));
        const lease = nic && sim.leases.get(nic.id);
        return lease && "address" in lease ? ok : fail("noLease", d.name);
      }
      case "noErrors": {
        const errors = diagnose(topology).filter((f) => f.severity === "error").length;
        return errors ? fail("errors", String(errors)) : ok;
      }
    }
  });
}

/** Device names in a topology, for check editors. */
export function deviceNames(t: Topology): { name: string; host: boolean }[] {
  return t.devices.map((d) => ({ name: d.name, host: isHost(d) }));
}
