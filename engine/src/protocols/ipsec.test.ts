import { describe, expect, it } from "vitest";
import { IosSession } from "../cli/ios.js";
import { diagnose } from "../diagnostics.js";
import type { Topology } from "../model.js";
import { Simulator } from "../simulator.js";
import { lab } from "../testkit.test-helper.js";

/** Two sites over an "internet" router (R2) that knows nothing about the private LANs. */
function sites() {
  return lab()
    .add("router", "R1")
    .add("router", "R2")
    .add("router", "R3")
    .host("pc", "PC1", "10.1.0.10", 24, "10.1.0.1")
    .host("server", "SRV1", "10.3.0.10", 24, "10.3.0.1")
    .ip("R1", "0/0", "10.1.0.1", 24)
    .ip("R1", "0/1", "203.0.113.1", 30)
    .ip("R2", "0/1", "203.0.113.2", 30)
    .ip("R2", "0/2", "198.51.100.1", 30)
    .ip("R3", "0/2", "198.51.100.2", 30)
    .ip("R3", "0/0", "10.3.0.1", 24)
    .link("R1", "0/0", "PC1", "Ethernet0")
    .link("R3", "0/0", "SRV1", "Ethernet0")
    .link("R1", "0/1", "R2", "0/1")
    .link("R2", "0/2", "R3", "0/2").t;
}

function cli(t: Topology) {
  let topo = t;
  let sim = new Simulator(topo);
  const sessions = new Map<string, IosSession>();
  const run = (name: string, ...lines: string[]) => {
    const d = topo.devices.find((x) => x.name === name)!;
    let s = sessions.get(d.id);
    if (!s) {
      s = new IosSession(d.id);
      sessions.set(d.id, s);
      s.execute("enable", { topology: topo, sim });
    }
    let out: string[] = [];
    for (const l of lines) {
      const r = s.execute(l, { topology: topo, sim });
      if (r.topology) {
        topo = r.topology;
        sim = new Simulator(topo);
      }
      out = r.output;
    }
    return out.join("\n");
  };
  const id = (name: string) => topo.devices.find((x) => x.name === name)!.id;
  return {
    run,
    ping: (from: string, to: string) => sim.ping(id(from), to, { count: 2 }),
    trace: (from: string, to: string) => sim.traceroute(id(from), to),
    get t() {
      return topo;
    },
    get sim() {
      return sim;
    },
  };
}

function vpn(c: ReturnType<typeof cli>, r: "R1" | "R3", opts: { key?: string; acl?: string; hash?: string } = {}) {
  const [peer, local, remote] = r === "R1" ? ["198.51.100.2", "10.1.0.0", "10.3.0.0"] : ["203.0.113.1", "10.3.0.0", "10.1.0.0"];
  c.run(
    r,
    "conf t",
    `ip route 0.0.0.0 0.0.0.0 ${r === "R1" ? "203.0.113.2" : "198.51.100.1"}`,
    "crypto isakmp policy 10",
    "encryption aes 256",
    `hash ${opts.hash ?? "sha256"}`,
    "authentication pre-share",
    "group 14",
    "exit",
    `crypto isakmp key ${opts.key ?? "Lab-Secret1"} address ${peer}`,
    "crypto ipsec transform-set TS esp-aes 256 esp-sha-hmac",
    "mode tunnel",
    "exit",
    opts.acl ?? `access-list 110 permit ip ${local} 0.0.0.255 ${remote} 0.0.0.255`,
    "crypto map VPN 10 ipsec-isakmp",
    `set peer ${peer}`,
    "set transform-set TS",
    "match address 110",
    "exit",
    `int ${r === "R1" ? "g0/1" : "g0/2"}`,
    "crypto map VPN",
    "end",
  );
}

describe("ipsec", () => {
  it("carries LAN traffic through an ESP tunnel that the internet router cannot see into", () => {
    const c = cli(sites());
    c.run("R1", "conf t", "ip route 0.0.0.0 0.0.0.0 203.0.113.2", "end");
    c.run("R3", "conf t", "ip route 0.0.0.0 0.0.0.0 198.51.100.1", "end");
    // Without a tunnel the internet router has no route to the private LAN.
    const before = c.ping("PC1", "10.3.0.10");
    expect(before.result.received).toBe(0);
    expect(before.events.some((e) => e.type === "drop" && e.reason === "no-route")).toBe(true);

    vpn(c, "R1");
    vpn(c, "R3");
    const run = c.ping("PC1", "10.3.0.10");
    expect(run.result.received).toBe(2);
    const r2 = c.t.devices.find((d) => d.name === "R2")!.id;
    const seenByR2 = run.events.filter((e) => e.type === "tx" && e.from.device === r2);
    expect(seenByR2.length).toBeGreaterThan(0);
    expect(seenByR2.every((e) => e.type === "tx" && (e.frame.kind === "esp" || e.frame.kind.startsWith("arp")))).toBe(true);

    // Traceroute: R2 inside the tunnel is invisible. R3 answers from its outside address,
    // which the crypto ACL does not cover, so that reply is lost on the internet: "* * *".
    const tr = c.trace("PC1", "10.3.0.10");
    expect(tr.result.reached).toBe(true);
    expect(tr.result.hops.map((h) => h.address ?? h.status)).toEqual(["10.1.0.1", "timeout", "10.3.0.10"]);

    expect(c.run("R1", "ping 10.3.0.10 source g0/0")).toContain("Success rate is 100 percent (5/5)");
    expect(c.run("R1", "ping 10.3.0.10")).toContain("Success rate is 0 percent");
    expect(c.run("R1", "show crypto isakmp sa")).toMatch(/198\.51\.100\.2\s+203\.0\.113\.1\s+QM_IDLE\s+\d+\s+ACTIVE/);
    const sa = c.run("R1", "show crypto ipsec sa");
    expect(sa).toContain("local  ident (addr/mask/prot/port): (10.1.0.0/255.255.255.0/0/0)");
    expect(sa).toMatch(/#pkts encaps: [1-9]/);
    expect(sa).toContain("transform: esp-aes 256 esp-sha-hmac ,");
    expect(c.run("R1", "show crypto session")).toContain("Session status: UP-ACTIVE");
    const cfg = c.run("R1", "show run");
    expect(cfg).toContain("crypto isakmp policy 10\n encr aes 256\n hash sha256\n authentication pre-share\n group 14");
    expect(cfg).toContain("crypto isakmp key Lab-Secret1 address 198.51.100.2");
    expect(cfg).toContain("crypto map VPN 10 ipsec-isakmp\n set peer 198.51.100.2\n set transform-set TS\n match address 110");
    expect(cfg).toContain("interface GigabitEthernet0/1\n ip address 203.0.113.1 255.255.255.252\n crypto map VPN");
    expect(diagnose(c.t).filter((f) => f.code.startsWith("ipsec"))).toEqual([]);
  });

  it("explains why a tunnel stays down", () => {
    const c = cli(sites());
    vpn(c, "R1");
    vpn(c, "R3", { key: "wrong" });
    expect(diagnose(c.t).map((f) => f.code)).toContain("ipsec.key");
    const run = c.ping("PC1", "10.3.0.10");
    expect(run.result.received).toBe(0);
    expect(run.events.some((e) => e.type === "drop" && e.reason === "ipsec-no-sa")).toBe(true);
    expect(c.run("R1", "show crypto session")).toContain("pre-shared keys do not match");
    expect(c.run("R1", "show crypto isakmp sa")).toContain("MM_NO_STATE");

    // Fix the key, then break phase 1 and the crypto ACL in turn.
    c.run("R3", "conf t", "no crypto isakmp key wrong address 203.0.113.1", "crypto isakmp key Lab-Secret1 address 203.0.113.1", "end");
    expect(c.ping("PC1", "10.3.0.10").result.received).toBe(2);
    c.run("R3", "conf t", "crypto isakmp policy 10", "hash sha", "end");
    expect(diagnose(c.t).map((f) => f.code)).toContain("ipsec.isakmpPolicy");
    c.run("R3", "conf t", "crypto isakmp policy 10", "hash sha256", "end");
    c.run("R3", "conf t", "no access-list 110", "access-list 110 permit ip 10.3.0.0 0.0.0.255 10.0.0.0 0.255.255.255", "end");
    expect(diagnose(c.t).map((f) => f.code)).toContain("ipsec.acl");
  });

  it("needs ESP and IKE through the outside access list", () => {
    const c = cli(sites());
    vpn(c, "R1");
    vpn(c, "R3");
    c.run("R3", "conf t", "access-list 120 permit icmp any any", "int g0/2", "ip access-group 120 in", "end");
    expect(diagnose(c.t).map((f) => f.code)).toContain("ipsec.filtered");
    c.run("R3", "conf t", "access-list 120 permit udp host 203.0.113.1 host 198.51.100.2 eq isakmp", "access-list 120 permit esp host 203.0.113.1 host 198.51.100.2", "end");
    expect(diagnose(c.t).map((f) => f.code)).not.toContain("ipsec.filtered");
    expect(c.ping("PC1", "10.3.0.10").result.received).toBe(2);
  });

  it("ships a working site-to-site template", async () => {
    const { createFromTemplate } = await import("../templates.js");
    const c = cli(createFromTemplate("ipsec"));
    expect(c.ping("PC1", "10.2.0.10").result.received).toBe(2);
    expect(diagnose(c.t).filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("validates crypto commands", () => {
    const c = cli(sites());
    expect(c.run("R1", "conf t", "crypto ipsec transform-set X esp-foo")).toContain("Invalid transform");
    expect(c.run("R1", "crypto map VPN 10")).toContain("NOTE: This new crypto map will remain disabled");
    expect(c.run("R1", "set peer 1.2.3.4", "end", "show crypto map")).toContain("Peer = 1.2.3.4");
    expect(c.run("R1", "conf t", "crypto isakmp policy 5", "group 3")).toContain("not supported");
    expect(c.run("R1", "end", "show crypto isakmp policy")).toContain("Protection suite of priority 5");
    expect(diagnose(c.t).map((f) => f.code)).not.toContain("ipsec.incomplete");
    c.run("R1", "conf t", "int g0/1", "crypto map VPN", "end");
    expect(diagnose(c.t).map((f) => f.code)).toContain("ipsec.incomplete");
    const sw = cli(lab().add("switch24", "SW1").t);
    expect(sw.run("SW1", "conf t", "crypto isakmp policy 10")).toContain("needs a router");
  });
});
