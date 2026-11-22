import { describe, expect, it } from "vitest";
import { IosSession } from "./cli/ios.js";
import { evaluateChecks, parseChecks } from "./lessons.js";
import type { Topology } from "./model.js";
import { BUILTIN_SCENARIOS } from "./scenarios.js";
import { parseTopology } from "./schema.js";
import { Simulator } from "./simulator.js";

function ios(t: Topology, device: string, lines: string[]): Topology {
  const d = t.devices.find((x) => x.name === device)!;
  const s = new IosSession(d.id);
  for (const l of ["enable", "conf t", ...lines, "end"]) {
    const r = s.execute(l, { topology: t, sim: new Simulator(t) });
    if (r.topology) t = r.topology;
  }
  return t;
}

/** A working fix per scenario, as a student would type it. */
const FIXES: Record<string, (t: Topology) => Topology> = {
  "same-lan": (t) => {
    t.devices.find((d) => d.name === "PC2")!.interfaces[0]!.ip = { address: "192.168.1.11", prefix: 24 };
    return t;
  },
  gateway: (t) => {
    t.devices.find((d) => d.name === "PC1")!.defaultGateway = "10.1.0.1";
    return t;
  },
  "return-route": (t) => ios(t, "R2", ["ip route 10.1.0.0 255.255.255.0 172.16.0.1"]),
  "vlan-trunk": (t) => ios(t, "SW1", ["int g0/1", "switchport trunk allowed vlan 10,20"]),
  "ospf-adjacency": (t) => ios(t, "R3", ["router ospf 1", "no network 10.0.0.0 0.255.255.255 area 1", "network 10.0.0.0 0.255.255.255 area 0", "no passive-interface g0/2"]),
  "dhcp-relay": (t) => ios(t, "R1", ["int g0/0", "ip helper-address 10.2.0.10"]),
  "acl-web": (t) => ios(t, "R1", ["ip access-list extended OFFICE-IN", "no 20"]),
  "bgp-peering": (t) => ios(t, "R2", ["router bgp 65002", "no neighbor 192.0.2.1", "neighbor 192.0.2.1 remote-as 65001"]),
  "vpn-down": (t) =>
    ios(t, "R2", ["no crypto isakmp key Lab-Secret2 address 203.0.113.1", "crypto isakmp key Lab-Secret1 address 203.0.113.1", "no access-list 110", "access-list 110 permit ip 10.2.0.0 0.0.0.255 10.1.0.0 0.0.0.255"]),
};

describe("built-in scenarios", () => {
  for (const s of BUILTIN_SCENARIOS) {
    it(`${s.key}: starts broken and passes once fixed`, () => {
      const start = parseTopology(JSON.parse(JSON.stringify(s.build())));
      const before = evaluateChecks(start, s.checks);
      expect(before.some((r) => !r.passed)).toBe(true);
      const fixed = FIXES[s.key]!(start);
      const after = evaluateChecks(fixed, s.checks);
      expect(after.filter((r) => !r.passed)).toEqual([]);
      expect(typeof s.title === "object" && s.title.nl && s.briefing && s.hints.length).toBeTruthy();
    });
  }
});

describe("checks", () => {
  it("validates teacher input", () => {
    expect(parseChecks([{ type: "ping", from: "PC1", to: "10.0.0.1", expect: "reach" }])).toHaveLength(1);
    expect(parseChecks([{ type: "ping", from: "PC1", to: "10.0.0.1", expect: "maybe" }])).toBe("lessons.invalidChecks");
    expect(parseChecks([{ type: "route", device: "R1", network: "nope" }])).toBe("lessons.invalidChecks");
    expect(parseChecks("x")).toBe("lessons.invalidChecks");
  });

  it("explains failures", () => {
    const t = BUILTIN_SCENARIOS.find((s) => s.key === "acl-web")!.build();
    const r = evaluateChecks(t, [
      { id: "a", type: "ping", from: "Nobody", to: "1.1.1.1", expect: "reach" },
      { id: "b", type: "tcp", from: "PC1", to: "SRV1", port: 80, expect: "open" },
      { id: "c", type: "noErrors" },
    ]);
    expect(r).toEqual([
      { id: "a", passed: false, why: "noDevice", detail: "Nobody" },
      { id: "b", passed: false, why: "filtered", detail: "10.2.0.10:80" },
      { id: "c", passed: true },
    ]);
  });
});
