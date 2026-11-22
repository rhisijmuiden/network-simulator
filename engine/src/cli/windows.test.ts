import { describe, expect, it } from "vitest";
import { newId } from "../catalog.js";
import type { Device, Topology } from "../model.js";
import { Simulator } from "../simulator.js";
import { lab } from "../testkit.test-helper.js";
import { IosSession } from "./ios.js";
import { WindowsSession } from "./windows.js";

function services(d: Device) {
  d.services = {
    web: { enabled: true, title: "Intranet", body: "<h1>Welcome</h1>" },
    dns: { enabled: true, records: [{ id: newId("n"), name: "www.lab.local", address: "10.2.0.10" }] },
    dhcp: {
      enabled: true,
      pools: [
        { id: newId("p"), name: "LAN1", network: "10.1.0.0", prefix: 24, start: "10.1.0.100", end: "10.1.0.101", gateway: "10.1.0.1", dns: "10.2.0.10" },
        { id: newId("p"), name: "LAN2", network: "10.2.0.0", prefix: 24, start: "10.2.0.100", end: "10.2.0.150", gateway: "10.2.0.1", dns: "10.2.0.10" },
      ],
    },
    files: { enabled: true, shares: [{ id: newId("s"), name: "Public", files: ["readme.txt", "plan.docx"] }] },
  };
}

/** PC1 and PC2 on LAN 1 (DHCP), R1 routing to LAN 2 with the server. */
function campus() {
  return lab()
    .add("router", "R1")
    .add("switch24", "SW1")
    .add("pc", "PC1", (d) => (d.interfaces[0]!.dhcp = true))
    .add("pc", "PC2", (d) => (d.interfaces[0]!.dhcp = true))
    .add("pc", "PC3", (d) => (d.interfaces[0]!.dhcp = true))
    .host("server", "SRV1", "10.2.0.10", 24, "10.2.0.1")
    .ip("R1", "0/0", "10.1.0.1", 24)
    .ip("R1", "0/1", "10.2.0.1", 24)
    .link("R1", "0/0", "SW1", "FastEthernet0/24")
    .link("PC1", "Ethernet0", "SW1", "FastEthernet0/1")
    .link("PC2", "Ethernet0", "SW1", "FastEthernet0/2")
    .link("PC3", "Ethernet0", "SW1", "FastEthernet0/3")
    .link("R1", "0/1", "SRV1", "Ethernet0");
}

function prompt(t: Topology, name: string) {
  let topo = t;
  const d = t.devices.find((x) => x.name === name)!;
  const s = new WindowsSession(d.id);
  let sim = new Simulator(topo);
  return {
    run: (line: string) => {
      const r = s.execute(line, { topology: topo, sim });
      if (r.topology) {
        topo = r.topology;
        sim = new Simulator(topo);
      }
      return r.output.join("\n");
    },
    get t() {
      return topo;
    },
  };
}

describe("dhcp", () => {
  it("leases through ip helper-address and runs out when the pool is empty", () => {
    const b = campus();
    services(b.dev("SRV1"));
    let t = b.t;
    // No relay yet: Windows falls back to APIPA.
    expect(prompt(t, "PC1").run("ipconfig")).toContain("Autoconfiguration IPv4 Address");
    const r1 = new IosSession(b.dev("R1").id);
    for (const l of ["en", "conf t", "int g0/0", "ip helper-address 10.2.0.10", "end"]) {
      const r = r1.execute(l, { topology: t, sim: new Simulator(t) });
      if (r.topology) t = r.topology;
    }
    const sim = new Simulator(t);
    const ips = ["PC1", "PC2", "PC3"].map((n) => sim.topology.devices.find((d) => d.name === n)!.interfaces[0]!.ip?.address);
    expect(ips).toEqual(["10.1.0.100", "10.1.0.101", undefined]);
    const pc3 = sim.leases.get(t.devices.find((d) => d.name === "PC3")!.interfaces[0]!.id);
    expect(pc3).toMatchObject({ error: "exhausted" });
    const out = prompt(t, "PC1").run("ipconfig /all");
    expect(out).toContain("IPv4 Address. . . . . . . . . . . : 10.1.0.100");
    expect(out).toContain("Default Gateway . . . . . . . . . : 10.1.0.1");
    expect(out).toContain("DNS Servers . . . . . . . . . . . : 10.2.0.10");
    expect(out).toContain("DHCP Server . . . . . . . . . . . : 10.2.0.10");
    expect(prompt(t, "PC1").run("ping -n 2 10.2.0.10")).toContain("Received = 2");
  });

  it("serves its own segment without a relay", () => {
    const b = lab()
      .add("switch24", "SW1")
      .add("pc", "PC1", (d) => (d.interfaces[0]!.dhcp = true))
      .host("server", "SRV1", "10.2.0.10", 24)
      .link("PC1", "Ethernet0", "SW1", "FastEthernet0/1")
      .link("SRV1", "Ethernet0", "SW1", "FastEthernet0/2");
    services(b.dev("SRV1"));
    const sim = new Simulator(b.t);
    expect(sim.topology.devices.find((d) => d.name === "PC1")!.interfaces[0]!.ip).toEqual({ address: "10.2.0.100", prefix: 24 });
  });
});

describe("command prompt", () => {
  function ready() {
    const b = campus();
    services(b.dev("SRV1"));
    b.dev("R1").interfaces.find((i) => i.name === "GigabitEthernet0/0")!.helperAddress = "10.2.0.10";
    return b.t;
  }

  it("resolves names, fetches a web page and lists shares", () => {
    const p = prompt(ready(), "PC1");
    expect(p.run("nslookup www.lab.local")).toContain("Address:  10.2.0.10");
    expect(p.run("nslookup nope.lab.local")).toContain("can't find nope.lab.local: Non-existent domain");
    expect(p.run("ping www.lab.local")).toContain("Pinging www.lab.local [10.2.0.10] with 32 bytes of data:");
    expect(p.run("curl http://www.lab.local/")).toContain("<h1>Welcome</h1>");
    expect(p.run("net view \\\\10.2.0.10")).toContain("Public");
    expect(p.run("dir \\\\10.2.0.10\\Public")).toContain("plan.docx");
    expect(p.run("ftp 10.2.0.10")).toContain("230 Login successful.");
    expect(p.run("telnet 10.2.0.10 25")).toContain("Could not open connection");
    expect(p.run("tracert 10.2.0.10")).toContain("Trace complete.");
    expect(p.run("arp -a")).toContain("10.1.0.1");
    expect(p.run("foo")).toContain("is not recognized");
  });

  it("changes the address with netsh", () => {
    const p = prompt(ready(), "PC1");
    expect(p.run('netsh interface ip set address "Ethernet0" static 10.1.0.50 255.255.255.0 10.1.0.1').trim()).toBe("Ok.");
    const nicCfg = p.t.devices.find((d) => d.name === "PC1")!.interfaces[0]!;
    expect(nicCfg).toMatchObject({ dhcp: false, ip: { address: "10.1.0.50", prefix: 24 } });
    expect(p.run("ipconfig")).toContain("10.1.0.50");
    // Without a DNS server, names do not resolve.
    expect(p.run("ping www.lab.local")).toContain("could not find host");
    p.run('netsh interface ip set dns "Ethernet0" static 10.2.0.10');
    expect(p.run("ping -n 1 www.lab.local")).toContain("Received = 1");
    p.run('netsh interface ip set address "Ethernet0" dhcp');
    expect(p.run("ipconfig")).toContain("10.1.0.10");
  });
});
