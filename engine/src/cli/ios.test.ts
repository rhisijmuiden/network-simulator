import { describe, expect, it } from "vitest";
import type { Topology } from "../model.js";
import { Simulator } from "../simulator.js";
import { lab } from "../testkit.test-helper.js";
import { parseIfName } from "./ifname.js";
import { IosSession, parseAclRule } from "./ios.js";
import { matchCommand, pattern } from "./parser.js";

/** Runs commands on one device and keeps the topology up to date, like the web console does. */
function consoleOn(t: Topology, name: string) {
  let topo = t;
  const d = t.devices.find((x) => x.name === name)!;
  const s = new IosSession(d.id);
  const run = (...lines: string[]) => {
    let last: string[] = [];
    for (const l of lines) {
      const r = s.execute(l, { topology: topo, sim: new Simulator(topo) });
      if (r.topology) topo = r.topology;
      last = r.output;
    }
    return last;
  };
  return { s, run, get t() { return topo; }, dev: () => topo.devices.find((x) => x.id === d.id)! };
}

describe("cli parser", () => {
  const cmds = [
    { tokens: pattern("show ip route", {}), run: () => {} },
    { tokens: pattern("show ip interface brief", {}), run: () => {} },
    { tokens: pattern("show interfaces", {}), run: () => {} },
    { tokens: pattern("shutdown", {}), run: () => {} },
  ];
  it("accepts unique abbreviations", () => {
    expect(matchCommand("sho ip ro", cmds).ok).toBe(true);
    expect(matchCommand("sho ip int br", cmds).ok).toBe(true);
  });
  it("reports ambiguous, incomplete and invalid input", () => {
    expect(matchCommand("sh", cmds)).toMatchObject({ ok: false, error: "ambiguous" });
    expect(matchCommand("show ip", cmds)).toMatchObject({ ok: false, error: "incomplete" });
    expect(matchCommand("show ip rot", cmds)).toMatchObject({ ok: false, error: "invalid", at: 8 });
  });
  it("parses interface names", () => {
    expect(parseIfName("g0/1")?.full).toBe("GigabitEthernet0/1");
    expect(parseIfName("Fa0/24")?.full).toBe("FastEthernet0/24");
    expect(parseIfName("te1/1/1")?.full).toBe("TenGigabitEthernet1/1/1");
    expect(parseIfName("gig0/0.20")?.full).toBe("GigabitEthernet0/0.20");
    expect(parseIfName("lo0")?.full).toBe("Loopback0");
    expect(parseIfName("int0/1")).toBeNull();
  });
});

describe("ios session", () => {
  it("moves through the modes and shows the right prompts", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    expect(c.s.prompt(c.t)).toBe("R1>");
    c.run("en");
    expect(c.s.prompt(c.t)).toBe("R1#");
    c.run("conf t");
    expect(c.s.prompt(c.t)).toBe("R1(config)#");
    c.run("int g0/0");
    expect(c.s.prompt(c.t)).toBe("R1(config-if)#");
    c.run("exit", "hostname EDGE");
    expect(c.s.prompt(c.t)).toBe("EDGE(config)#");
    c.s.end();
    expect(c.s.prompt(c.t)).toBe("EDGE#");
  });

  it("refuses configuration in user EXEC and marks the error", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    const out = c.run("configure terminal");
    expect(out.at(-1)).toBe("% Invalid input detected at '^' marker.");
    expect(out[0]).toBe(`${" ".repeat("R1>".length)}^`);
  });

  it("configures an interface and builds a working network", () => {
    const t = lab().add("router", "R1").host("pc", "PC1", "192.168.1.10", 24, "192.168.1.1").link("R1", "0/0", "PC1", "Ethernet0").t;
    const c = consoleOn(t, "R1");
    c.run("enable", "configure terminal", "interface gi0/0", "ip address 192.168.1.1 255.255.255.0", "no shutdown", "description LAN", "end");
    const i = c.dev().interfaces.find((x) => x.name === "GigabitEthernet0/0")!;
    expect(i.ip).toEqual({ address: "192.168.1.1", prefix: 24 });
    expect(i.description).toBe("LAN");
    const ping = c.run("ping 192.168.1.10");
    expect(ping.join("\n")).toContain("Success rate is 100 percent (5/5)");
    expect(c.run("show running-config").join("\n")).toContain(" ip address 192.168.1.1 255.255.255.0");
    expect(c.run("sh ip int br").join("\n")).toMatch(/GigabitEthernet0\/0\s+192\.168\.1\.1/);
  });

  it("rejects overlapping and invalid addresses", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    c.run("en", "conf t", "int g0/0", "ip address 10.0.0.1 255.255.255.0", "int g0/1");
    expect(c.run("ip address 10.0.0.2 255.255.255.0")[0]).toContain("overlaps");
    expect(c.run("ip address 10.0.1.0 255.255.255.0")[0]).toContain("Bad mask");
  });

  it("sets static routes and removes them with no", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    c.run("en", "conf t", "ip route 10.2.0.0 255.255.0.0 10.0.0.2", "ip route 0.0.0.0 0.0.0.0 g0/1");
    expect(c.dev().staticRoutes).toHaveLength(2);
    c.run("no ip route 10.2.0.0 255.255.0.0 10.0.0.2");
    expect(c.dev().staticRoutes).toHaveLength(1);
  });

  it("configures VLANs, access ports and trunks on a switch", () => {
    const c = consoleOn(lab().add("switch24", "SW1").t, "SW1");
    c.run("en", "conf t", "vlan 10", "name SALES", "exit", "interface range fa0/1 - 4", "switchport mode access", "switchport access vlan 10");
    c.run("int g0/1", "switchport mode trunk", "switchport trunk allowed vlan 1,10", "switchport trunk allowed vlan add 20", "end");
    const d = c.dev();
    expect(d.vlans.map((v) => v.name)).toContain("SALES");
    expect(d.vlans.some((v) => v.id === 20)).toBe(false);
    expect(d.interfaces.filter((i) => i.accessVlan === 10).map((i) => i.name)).toEqual(["FastEthernet0/1", "FastEthernet0/2", "FastEthernet0/3", "FastEthernet0/4"]);
    const g = d.interfaces.find((i) => i.name === "GigabitEthernet0/1")!;
    expect(g.mode).toBe("trunk");
    expect(g.allowedVlans).toBe("1,10,20");
    expect(c.run("show vlan brief").join("\n")).toMatch(/10\s+SALES/);
    c.run("conf t", "int fa0/5");
    expect(c.run("ip address 10.0.0.1 255.0.0.0")[0]).toContain("L2");
  });

  it("creates SVIs, loopbacks and subinterfaces on demand", () => {
    const t = lab().add("router", "R1").add("l3switch24", "MLS1").t;
    const r = consoleOn(t, "R1");
    r.run("en", "conf t", "int g0/0.20", "encapsulation dot1Q 20", "ip address 10.20.0.1 255.255.255.0", "exit", "int lo0");
    expect(r.s.prompt(r.t)).toBe("R1(config-if)#");
    const sub = r.dev().interfaces.find((i) => i.name === "GigabitEthernet0/0.20")!;
    expect(sub).toMatchObject({ type: "subinterface", vlan: 20 });
    expect(r.dev().interfaces.some((i) => i.name === "Loopback0")).toBe(true);
    const m = consoleOn(r.t, "MLS1");
    m.run("en", "conf t", "ip routing", "int vlan 30", "ip address 10.30.0.1 255.255.255.0");
    expect(m.dev().interfaces.find((i) => i.name === "Vlan30")?.ip?.address).toBe("10.30.0.1");
  });

  it("builds named and numbered ACLs and applies them", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    c.run("en", "conf t", "ip access-list extended WEB", "permit tcp any host 10.0.0.5 eq www", "deny ip any any", "exit");
    c.run("access-list 10 permit 192.168.1.0 0.0.0.255", "int g0/0", "ip access-group WEB in");
    const d = c.dev();
    const web = d.acls.find((a) => a.name === "WEB")!;
    expect(web.rules).toHaveLength(2);
    expect(web.rules[0]).toMatchObject({ action: "permit", protocol: "tcp", dstPort: { op: "eq", from: 80 } });
    expect(d.acls.find((a) => a.name === "10")?.type).toBe("standard");
    expect(d.interfaces.find((i) => i.name === "GigabitEthernet0/0")?.aclIn).toBe("WEB");
    expect(c.run("do show access-lists").join("\n")).toContain("permit tcp any host 10.0.0.5 eq www");
    expect(c.s.prompt(c.t)).toBe("R1(config-if)#");
    expect(parseAclRule("permit tcp any any eq bogus", false)).toMatch(/^%/);
  });

  it("jumps to global commands from a sub-mode", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    c.run("en", "conf t", "int g0/0", "hostname R9");
    expect(c.s.prompt(c.t)).toBe("R9(config)#");
  });

  it("gives ? help and Tab completion", () => {
    const c = consoleOn(lab().add("router", "R1").t, "R1");
    c.run("en");
    expect(c.s.help("sh")).toEqual(["show"]);
    const h = c.s.help("show ip ");
    expect(h.some((l) => l.includes("route"))).toBe(true);
    expect(c.s.complete("sh")).toBe("show ");
    expect(c.s.complete("show ip ro")).toBe("show ip route ");
    expect(c.s.help("xyz")).toEqual(["% Unrecognized command"]);
  });

  it("shows the 6500 chassis modules", () => {
    const c = consoleOn(lab().add("chassis6500", "CORE1").t, "CORE1");
    const out = c.run("show module").join("\n");
    expect(out).toContain("48-port");
    expect(out).toContain("Supervisor");
    c.run("en", "conf t", "int te2/1", "no switchport", "ip address 10.9.9.1 255.255.255.252");
    expect(c.dev().interfaces.find((i) => i.name === "TenGigabitEthernet2/1")?.mode).toBe("routed");
  });

  it("returns no topology for show commands", () => {
    const t = lab().add("router", "R1").t;
    const s = new IosSession(t.devices[0]!.id);
    expect(s.execute("show version", { topology: t, sim: new Simulator(t) }).topology).toBeUndefined();
  });
});
