import { describe, expect, it } from "vitest";
import { IosSession } from "../cli/ios.js";
import { formatIp } from "../ip.js";
import type { Topology } from "../model.js";
import { Simulator } from "../simulator.js";
import { lab } from "../testkit.test-helper.js";

function cli(t: Topology) {
  let topo = t;
  const sessions = new Map<string, IosSession>();
  const run = (name: string, ...lines: string[]) => {
    const d = topo.devices.find((x) => x.name === name)!;
    let s = sessions.get(d.id);
    if (!s) {
      s = new IosSession(d.id);
      sessions.set(d.id, s);
      s.execute("enable", { topology: topo, sim: new Simulator(topo) });
    }
    let out: string[] = [];
    for (const l of lines) {
      const r = s.execute(l, { topology: topo, sim: new Simulator(topo) });
      if (r.topology) topo = r.topology;
      out = r.output;
    }
    return out;
  };
  const routes = (name: string) => {
    const sim = new Simulator(topo);
    const d = topo.devices.find((x) => x.name === name)!;
    return sim.routingTable(d.id).map((r) => `${r.code ?? r.protocol} ${formatIp(r.network)}/${r.prefix}${r.nextHop !== undefined ? ` via ${formatIp(r.nextHop)}` : ""} [${r.distance}/${r.metric}]`);
  };
  const ping = (from: string, to: string) => {
    const sim = new Simulator(topo);
    return sim.ping(topo.devices.find((x) => x.name === from)!.id, to, { count: 2 }).result.received;
  };
  return { run, routes, ping, get t() { return topo; } };
}

/** R1 - R2 - R3 in a line plus a shortcut R1 - R3; a PC behind R1 and a server behind R3. */
function triangle() {
  return lab()
    .add("router", "R1")
    .add("router", "R2")
    .add("router", "R3")
    .host("pc", "PC1", "10.1.0.10", 24, "10.1.0.1")
    .host("server", "SRV1", "10.3.0.10", 24, "10.3.0.1")
    .ip("R1", "0/0", "10.1.0.1", 24)
    .ip("R1", "0/1", "10.0.12.1", 30)
    .ip("R2", "0/1", "10.0.12.2", 30)
    .ip("R2", "0/2", "10.0.23.1", 30)
    .ip("R3", "0/2", "10.0.23.2", 30)
    .ip("R3", "0/0", "10.3.0.1", 24)
    .ip("R1", "0/3", "10.0.13.1", 30)
    .ip("R3", "0/3", "10.0.13.2", 30)
    .link("R1", "0/0", "PC1", "Ethernet0")
    .link("R3", "0/0", "SRV1", "Ethernet0")
    .link("R1", "0/1", "R2", "0/1")
    .link("R2", "0/2", "R3", "0/2")
    .link("R1", "0/3", "R3", "0/3").t;
}

describe("ospf", () => {
  it("learns routes, prefers the cheapest path and falls back when a link fails", () => {
    const c = cli(triangle());
    for (const r of ["R1", "R2", "R3"]) c.run(r, "conf t", "router ospf 1", "network 10.0.0.0 0.255.255.255 area 0", "end");
    expect(c.ping("PC1", "10.3.0.10")).toBe(2);
    expect(c.routes("R1")).toContain("ospf 10.3.0.0/24 via 10.0.13.2 [110/2]");
    // Equal-cost paths to 10.0.23.0/30: via R2 and via R3.
    expect(c.routes("R1").filter((r) => r.includes("10.0.23.0/30"))).toHaveLength(2);
    // Make the direct link expensive: traffic goes via R2.
    c.run("R1", "conf t", "int g0/3", "ip ospf cost 50", "end");
    expect(c.routes("R1")).toContain("ospf 10.3.0.0/24 via 10.0.12.2 [110/3]");
    expect(c.run("R1", "show run").join("\n")).toContain(" ip ospf cost 50");
    // Shut the R1-R2 link: back over the expensive link.
    c.run("R2", "conf t", "int g0/1", "shutdown", "end");
    expect(c.routes("R1")).toContain("ospf 10.3.0.0/24 via 10.0.13.2 [110/51]");
    expect(c.ping("PC1", "10.3.0.10")).toBe(2);
  });

  it("shows neighbours and explains why an adjacency does not form", () => {
    const c = cli(triangle());
    c.run("R1", "conf t", "router ospf 1", "network 10.0.0.0 0.255.255.255 area 0", "router-id 1.1.1.1", "end");
    c.run("R3", "conf t", "router ospf 1", "network 10.0.13.0 0.0.0.3 area 1", "network 10.3.0.0 0.0.0.255 area 0", "end");
    c.run("R2", "conf t", "router ospf 1", "network 10.0.0.0 0.255.255.255 area 0", "passive-interface g0/1", "end");
    expect(c.run("R1", "show ip ospf neighbor").join("\n")).not.toContain("10.0.13.2");
    const why = c.run("R1", "show ip ospf").join("\n");
    expect(why).toContain("area mismatch");
    expect(why).toContain("passive interface");
    expect(c.ping("PC1", "10.3.0.10")).toBe(0);
    c.run("R3", "conf t", "router ospf 1", "no network 10.0.13.0 0.0.0.3 area 1", "network 10.0.13.0 0.0.0.3 area 0", "end");
    expect(c.run("R1", "show ip ospf neighbor").join("\n")).toMatch(/FULL\/.*10\.0\.13\.2\s+GigabitEthernet0\/3/);
    expect(c.ping("PC1", "10.3.0.10")).toBe(2);
    expect(c.run("R1", "show run").join("\n")).toContain("router ospf 1\n router-id 1.1.1.1\n network 10.0.0.0 0.255.255.255 area 0");
  });

  it("marks inter-area routes and spreads a default route", () => {
    const c = cli(triangle());
    c.run("R1", "conf t", "router ospf 1", "network 10.0.12.0 0.0.0.3 area 0", "network 10.1.0.0 0.0.0.255 area 0", "end");
    c.run("R2", "conf t", "router ospf 1", "network 10.0.12.0 0.0.0.3 area 0", "network 10.0.23.0 0.0.0.3 area 2", "end");
    c.run("R3", "conf t", "ip route 0.0.0.0 0.0.0.0 10.3.0.10", "router ospf 1", "network 10.0.23.0 0.0.0.3 area 2", "default-information originate", "end");
    expect(c.routes("R1")).toContain("O IA 10.0.23.0/30 via 10.0.12.2 [110/2]");
    expect(c.routes("R1")).toContain("O*E2 0.0.0.0/0 via 10.0.12.2 [110/1]");
    expect(c.run("R1", "show ip route").join("\n")).toContain("Gateway of last resort is 10.0.12.2");
  });

  it("refuses OSPF on a layer 2 switch", () => {
    const c = cli(lab().add("switch24", "SW1").t);
    expect(c.run("SW1", "conf t", "router ospf 1")[0]).toContain("router or a multilayer switch");
  });
});

/** AS 65001 (R1) - AS 65002 (R2, R3 in iBGP) - with a PC behind R1 and a server behind R3. */
function asLab() {
  return lab()
    .add("router", "R1")
    .add("router", "R2")
    .add("router", "R3")
    .host("pc", "PC1", "10.1.0.10", 24, "10.1.0.1")
    .host("server", "SRV1", "10.3.0.10", 24, "10.3.0.1")
    .ip("R1", "0/0", "10.1.0.1", 24)
    .ip("R1", "0/1", "192.0.2.1", 30)
    .ip("R2", "0/1", "192.0.2.2", 30)
    .ip("R2", "0/2", "10.0.23.1", 30)
    .ip("R3", "0/2", "10.0.23.2", 30)
    .ip("R3", "0/0", "10.3.0.1", 24)
    .link("R1", "0/0", "PC1", "Ethernet0")
    .link("R3", "0/0", "SRV1", "Ethernet0")
    .link("R1", "0/1", "R2", "0/1")
    .link("R2", "0/2", "R3", "0/2").t;
}

describe("bgp", () => {
  it("brings up eBGP and iBGP sessions and exchanges routes", () => {
    const c = cli(asLab());
    c.run("R1", "conf t", "router bgp 65001", "neighbor 192.0.2.2 remote-as 65002", "network 10.1.0.0 mask 255.255.255.0", "end");
    c.run("R2", "conf t", "router bgp 65002", "neighbor 192.0.2.1 remote-as 65001", "neighbor 10.0.23.2 remote-as 65002", "end");
    c.run("R3", "conf t", "router bgp 65002", "neighbor 10.0.23.1 remote-as 65002", "network 10.3.0.0 mask 255.255.255.0", "end");
    expect(c.run("R1", "show ip bgp summary").join("\n")).toMatch(/192\.0\.2\.2\s+4\s+65002.*\s1$/m);
    expect(c.routes("R1")).toContain("bgp 10.3.0.0/24 via 192.0.2.2 [20/0]");
    // R3 learns 10.1.0.0/24 over iBGP with the next hop unchanged (192.0.2.1), which it cannot reach.
    expect(c.routes("R3").some((r) => r.includes("10.1.0.0/24"))).toBe(false);
    expect(c.run("R3", "show ip bgp").join("\n")).not.toContain("10.1.0.0/24");
    c.run("R2", "conf t", "router bgp 65002", "neighbor 10.0.23.2 next-hop-self", "end");
    expect(c.routes("R3")).toContain("bgp 10.1.0.0/24 via 10.0.23.1 [200/0]");
    expect(c.ping("PC1", "10.3.0.10")).toBe(2);
    const table = c.run("R1", "show ip bgp").join("\n");
    expect(table).toMatch(/10\.3\.0\.0\/24\s+192\.0\.2\.2.*65002 i/);
    expect(table).toMatch(/10\.1\.0\.0\/24\s+0\.0\.0\.0.*32768 i/);
  });

  it("keeps a session down on a wrong remote AS", () => {
    const c = cli(asLab());
    c.run("R1", "conf t", "router bgp 65001", "neighbor 192.0.2.2 remote-as 65009", "end");
    c.run("R2", "conf t", "router bgp 65002", "neighbor 192.0.2.1 remote-as 65001", "end");
    expect(c.run("R1", "show ip bgp summary").join("\n")).toMatch(/192\.0\.2\.2.*Active$/m);
    expect(c.run("R1", "show run").join("\n")).toContain("router bgp 65001\n neighbor 192.0.2.2 remote-as 65009");
  });
});

describe("diagnostics", () => {
  it("reports OSPF area mismatches and BGP sessions that stay down", async () => {
    const { diagnose } = await import("../diagnostics.js");
    const c = cli(triangle());
    c.run("R1", "conf t", "router ospf 1", "network 10.0.12.0 0.0.0.3 area 0", "end");
    c.run("R2", "conf t", "router ospf 1", "network 10.0.12.0 0.0.0.3 area 1", "end");
    c.run("R3", "conf t", "router bgp 65003", "neighbor 10.0.13.1 remote-as 65001", "end");
    const codes = diagnose(c.t).map((f) => f.code);
    expect(codes).toContain("ospf.area");
    expect(codes).toContain("bgp.noPeer");
  });
});
