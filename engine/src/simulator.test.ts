import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics.js";
import { maskToPrefix, parseIp, parseVlanList, prefixToMask, wildcardMatch } from "./ip.js";
import { parseTopology } from "./schema.js";
import { Simulator } from "./simulator.js";
import { lab } from "./testkit.test-helper.js";

describe("ip helpers", () => {
  it("parses and converts", () => {
    expect(parseIp("192.168.1.1")).toBe(0xc0a80101);
    expect(parseIp("256.1.1.1")).toBeNull();
    expect(maskToPrefix("255.255.255.0")).toBe(24);
    expect(maskToPrefix("255.0.255.0")).toBeNull();
    expect(maskToPrefix("0.0.0.0")).toBe(0);
    expect(prefixToMask(30)).toBe("255.255.255.252");
    expect(wildcardMatch(parseIp("10.1.2.3")!, parseIp("10.1.0.0")!, parseIp("0.0.255.255")!)).toBe(true);
    expect(parseVlanList("1,10-12")).toEqual(new Set([1, 10, 11, 12]));
  });
});

/** Two PCs on one switch. */
function flat() {
  return lab()
    .add("switch24", "SW1")
    .host("pc", "PC1", "192.168.1.10", 24, "192.168.1.1")
    .host("pc", "PC2", "192.168.1.11", 24, "192.168.1.1")
    .link("PC1", "Ethernet0", "SW1", "FastEthernet0/1")
    .link("PC2", "Ethernet0", "SW1", "FastEthernet0/2");
}

describe("layer 2", () => {
  it("pings across a switch, with ARP first, and learns MAC addresses", () => {
    const l = flat();
    const sim = new Simulator(l.t);
    const run = sim.ping(l.dev("PC1").id, "192.168.1.11");
    expect(run.result.received).toBe(4);
    const kinds = run.events.filter((e) => e.type === "tx").map((e) => (e.type === "tx" ? e.frame.kind : ""));
    expect(kinds[0]).toBe("arp-request");
    expect(kinds).toContain("arp-reply");
    expect(sim.macTable(l.dev("SW1").id)).toHaveLength(2);
    expect(sim.arpTable(l.dev("PC1").id)[0]?.ip).toBe("192.168.1.11");
    // Second ping: ARP is cached.
    const again = sim.ping(l.dev("PC1").id, "192.168.1.11", { count: 1 });
    expect(again.events.some((e) => e.type === "tx" && e.frame.kind.startsWith("arp"))).toBe(false);
  });

  it("isolates VLANs", () => {
    const l = flat().vlan("SW1", 10).set("SW1", "FastEthernet0/2", { accessVlan: 10 });
    const sim = new Simulator(l.t);
    const run = sim.ping(l.dev("PC1").id, "192.168.1.11", { count: 1 });
    expect(run.result.replies[0]).toMatchObject({ status: "timeout", reason: "arp-failed" });
  });

  it("drops frames for an access VLAN that does not exist", () => {
    const l = flat().set("SW1", "FastEthernet0/2", { accessVlan: 20 }).set("SW1", "FastEthernet0/1", { accessVlan: 20 });
    const run = new Simulator(l.t).ping(l.dev("PC1").id, "192.168.1.11", { count: 1 });
    expect(run.events.some((e) => e.type === "drop" && e.reason === "vlan-missing")).toBe(true);
    expect(diagnose(l.t).some((f) => f.code === "accessVlanMissing")).toBe(true);
  });

  it("carries VLANs over a trunk and blocks a redundant link with STP", () => {
    const l = lab()
      .add("switch24", "SW1")
      .add("switch24", "SW2")
      .vlan("SW1", 10)
      .vlan("SW2", 10)
      .host("pc", "PC1", "10.0.10.1", 24)
      .host("pc", "PC2", "10.0.10.2", 24)
      .link("PC1", "Ethernet0", "SW1", "FastEthernet0/1")
      .link("PC2", "Ethernet0", "SW2", "FastEthernet0/1")
      .set("SW1", "FastEthernet0/1", { accessVlan: 10 })
      .set("SW2", "FastEthernet0/1", { accessVlan: 10 })
      .set("SW1", "GigabitEthernet0/1", { mode: "trunk" })
      .set("SW2", "GigabitEthernet0/1", { mode: "trunk" })
      .set("SW1", "GigabitEthernet0/2", { mode: "trunk" })
      .set("SW2", "GigabitEthernet0/2", { mode: "trunk" })
      .link("SW1", "GigabitEthernet0/1", "SW2", "GigabitEthernet0/1")
      .link("SW1", "GigabitEthernet0/2", "SW2", "GigabitEthernet0/2");
    const sim = new Simulator(l.t);
    const blocked = [...sim.stp.ports.values()].filter((p) => p.state === "blocking");
    expect(blocked).toHaveLength(1);
    const run = sim.ping(l.dev("PC1").id, "10.0.10.2");
    expect(run.result.received).toBe(4);
    expect(run.events.some((e) => e.type === "storm")).toBe(false);
    // Tagged on the trunk.
    expect(run.events.some((e) => e.type === "tx" && e.frame.vlan === 10)).toBe(true);
  });

  it("detects a broadcast storm when STP is off on a loop", () => {
    const l = flat()
      .add("switch24", "SW2")
      .link("SW1", "GigabitEthernet0/1", "SW2", "GigabitEthernet0/1")
      .link("SW1", "GigabitEthernet0/2", "SW2", "GigabitEthernet0/2");
    l.dev("SW1").stp.enabled = false;
    l.dev("SW2").stp.enabled = false;
    const run = new Simulator(l.t, { maxFrames: 300 }).ping(l.dev("PC1").id, "192.168.1.99", { count: 1 });
    expect(run.events.some((e) => e.type === "storm")).toBe(true);
  });
});

/** PC1 - R1 - R2 - PC2 with static routes. */
function routed() {
  return lab()
    .add("router", "R1")
    .add("router", "R2")
    .host("pc", "PC1", "10.1.0.10", 24, "10.1.0.1")
    .host("server", "SRV1", "10.2.0.10", 24, "10.2.0.1")
    .ip("R1", "GigabitEthernet0/0", "10.1.0.1", 24)
    .ip("R1", "GigabitEthernet0/1", "172.16.0.1", 30)
    .ip("R2", "GigabitEthernet0/1", "172.16.0.2", 30)
    .ip("R2", "GigabitEthernet0/0", "10.2.0.1", 24)
    .link("PC1", "Ethernet0", "R1", "GigabitEthernet0/0")
    .link("R1", "GigabitEthernet0/1", "R2", "GigabitEthernet0/1")
    .link("R2", "GigabitEthernet0/0", "SRV1", "Ethernet0");
}

describe("layer 3", () => {
  it("fails without routes and reports where", () => {
    const l = routed();
    const run = new Simulator(l.t).ping(l.dev("PC1").id, "10.2.0.10", { count: 1 });
    expect(run.result.replies[0]).toMatchObject({ status: "unreachable", from: "10.1.0.1", code: "net" });
    expect(run.events.find((e) => e.type === "drop")).toMatchObject({ reason: "no-route", device: l.dev("R1").id });
  });

  it("routes with static routes and traceroutes hop by hop", () => {
    const l = routed().route("R1", "10.2.0.0", 24, "172.16.0.2").route("R2", "10.1.0.0", 24, "172.16.0.1");
    const sim = new Simulator(l.t);
    expect(sim.ping(l.dev("PC1").id, "10.2.0.10").result.received).toBe(4);
    const tr = sim.traceroute(l.dev("PC1").id, "10.2.0.10");
    expect(tr.result.reached).toBe(true);
    expect(tr.result.hops.map((h) => h.address)).toEqual(["10.1.0.1", "172.16.0.2", "10.2.0.10"]);
    expect(tr.result.hops[1]?.name).toBe("R2");
  });

  it("reports a missing return route as a timeout", () => {
    const l = routed().route("R1", "10.2.0.0", 24, "172.16.0.2");
    const run = new Simulator(l.t).ping(l.dev("PC1").id, "10.2.0.10", { count: 1 });
    expect(run.result.replies[0]?.status).toBe("timeout");
    expect(run.events.some((e) => e.type === "drop" && e.reason === "no-route" && e.device === l.dev("R2").id)).toBe(true);
  });

  it("needs a default gateway on the host", () => {
    const l = routed().route("R1", "10.2.0.0", 24, "172.16.0.2").route("R2", "10.1.0.0", 24, "172.16.0.1");
    delete l.dev("PC1").defaultGateway;
    const run = new Simulator(l.t).ping(l.dev("PC1").id, "10.2.0.10", { count: 1 });
    expect(run.result.replies[0]).toMatchObject({ status: "unreachable", reason: "no-gateway" });
  });

  it("does not route over a shut interface", () => {
    const l = routed().route("R1", "10.2.0.0", 24, "172.16.0.2").route("R2", "10.1.0.0", 24, "172.16.0.1");
    l.ifc("R2", "GigabitEthernet0/1").enabled = false;
    const sim = new Simulator(l.t);
    expect(sim.routingTable(l.dev("R1").id).some((r) => r.protocol === "static")).toBe(false);
    expect(sim.ping(l.dev("PC1").id, "10.2.0.10", { count: 1 }).result.received).toBe(0);
  });

  it("applies extended ACLs with L4 matches", () => {
    const l = routed().route("R1", "10.2.0.0", 24, "172.16.0.2").route("R2", "10.1.0.0", 24, "172.16.0.1");
    const r2 = l.dev("R2");
    r2.acls.push({
      name: "WEB-ONLY",
      rules: [
        { id: "1", action: "permit", protocol: "tcp", src: { address: "0.0.0.0", wildcard: "255.255.255.255" }, dst: { address: "10.2.0.10", wildcard: "0.0.0.0" }, dstPort: { op: "eq", from: 80 } },
      ],
    });
    l.ifc("R2", "GigabitEthernet0/0").aclOut = "WEB-ONLY";
    const sim = new Simulator(l.t);
    expect(sim.tcpConnect(l.dev("PC1").id, "10.2.0.10", 80).result.status).toBe("open");
    expect(sim.tcpConnect(l.dev("PC1").id, "10.2.0.10", 22).result).toMatchObject({ status: "filtered" });
    const ping = sim.ping(l.dev("PC1").id, "10.2.0.10", { count: 1 });
    expect(ping.result.replies[0]).toMatchObject({ status: "unreachable", code: "admin", reason: "acl-out" });
  });

  it("answers closed ports with a reset", () => {
    const l = routed().route("R1", "10.2.0.0", 24, "172.16.0.2").route("R2", "10.1.0.0", 24, "172.16.0.1");
    expect(new Simulator(l.t).tcpConnect(l.dev("PC1").id, "10.2.0.10", 25).result.status).toBe("closed");
  });

  it("routes between VLANs on a stick and on a multilayer switch", () => {
    const l = lab()
      .add("router", "R1")
      .add("switch24", "SW1")
      .vlan("SW1", 10, 20)
      .host("pc", "PC10", "10.0.10.5", 24, "10.0.10.1")
      .host("pc", "PC20", "10.0.20.5", 24, "10.0.20.1")
      .set("SW1", "FastEthernet0/1", { accessVlan: 10 })
      .set("SW1", "FastEthernet0/2", { accessVlan: 20 })
      .set("SW1", "GigabitEthernet0/1", { mode: "trunk" })
      .link("PC10", "Ethernet0", "SW1", "FastEthernet0/1")
      .link("PC20", "Ethernet0", "SW1", "FastEthernet0/2")
      .link("SW1", "GigabitEthernet0/1", "R1", "GigabitEthernet0/0")
      .sub("R1", "GigabitEthernet0/0", 10, "10.0.10.1", 24)
      .sub("R1", "GigabitEthernet0/0", 20, "10.0.20.1", 24);
    const sim = new Simulator(l.t);
    expect(sim.ping(l.dev("PC10").id, "10.0.20.5").result.received).toBe(4);

    const m = lab()
      .add("l3switch24", "MLS1")
      .vlan("MLS1", 10, 20)
      .host("pc", "PC10", "10.0.10.5", 24, "10.0.10.1")
      .host("pc", "PC20", "10.0.20.5", 24, "10.0.20.1")
      .set("MLS1", "GigabitEthernet1/0/1", { accessVlan: 10 })
      .set("MLS1", "GigabitEthernet1/0/2", { accessVlan: 20 })
      .link("PC10", "Ethernet0", "MLS1", "GigabitEthernet1/0/1")
      .link("PC20", "Ethernet0", "MLS1", "GigabitEthernet1/0/2")
      .svi("MLS1", 10, "10.0.10.1", 24)
      .svi("MLS1", 20, "10.0.20.1", 24);
    const sim2 = new Simulator(m.t);
    expect(sim2.ping(m.dev("PC10").id, "10.0.20.5").result.received).toBe(4);
    m.dev("MLS1").ipRouting = false;
    expect(new Simulator(m.t).ping(m.dev("PC10").id, "10.0.20.5", { count: 1 }).result.received).toBe(0);
  });

  it("pings its own address without frames", () => {
    const l = flat();
    const run = new Simulator(l.t).ping(l.dev("PC1").id, "192.168.1.10", { count: 1 });
    expect(run.result.received).toBe(1);
    expect(run.events.filter((e) => e.type === "tx")).toHaveLength(0);
  });
});

describe("schema and diagnostics", () => {
  it("round-trips a topology through JSON validation", () => {
    const l = routed();
    expect(parseTopology(JSON.parse(JSON.stringify(l.t))).devices).toHaveLength(4);
    const bad = JSON.parse(JSON.stringify(l.t));
    bad.links.push({ ...bad.links[0], id: "dup" });
    expect(() => parseTopology(bad)).toThrow("topology.portInUse");
  });

  it("finds common mistakes", () => {
    const l = routed().ip("R2", "GigabitEthernet0/1", "172.16.1.2", 30);
    l.dev("PC1").defaultGateway = "10.9.0.1";
    const codes = diagnose(l.t).map((f) => f.code);
    expect(codes).toContain("subnetMismatch");
    expect(codes).toContain("gatewayOutside");
  });
});

describe("templates", () => {
  it("every starter lab works out of the box", async () => {
    const { TEMPLATE_IDS, createFromTemplate } = await import("./templates.js");
    for (const id of TEMPLATE_IDS) {
      const t = parseTopology(JSON.parse(JSON.stringify(createFromTemplate(id))));
      expect(diagnose(t).filter((f) => f.severity === "error")).toEqual([]);
      const hosts = t.devices.filter((d) => d.kind === "pc" || d.kind === "server");
      if (hosts.length < 2) continue;
      const sim = new Simulator(t);
      const target = hosts.at(-1)!.interfaces[0]!.ip!.address;
      expect(sim.ping(hosts[0]!.id, target).result.received, id).toBe(4);
    }
  });
});
