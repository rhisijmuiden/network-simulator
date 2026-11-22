import { createDevice, createSubinterface, newId } from "./catalog.js";
import { emptyTopology, type Device, type Interface, type Topology } from "./model.js";
import type { IpsecConfig } from "./protocols/ipsec.js";

/** Starter topologies offered when creating a new one. Names are i18n keys `templates.<id>`. */
export const TEMPLATE_IDS = ["blank", "switched", "routed", "vlans", "redundant", "ospf", "bgp", "services", "ipsec"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

function builder() {
  const t = emptyTopology();
  const find = (name: string) => t.devices.find((d) => d.name === name)!;
  const port = (d: Device, name: string): Interface => d.interfaces.find((i) => i.name === name)!;
  const b = {
    t,
    add(model: string, name: string, x: number, y: number, fn?: (d: Device) => void) {
      const d = createDevice(model, { name, x, y });
      fn?.(d);
      t.devices.push(d);
      return b;
    },
    host(model: "pc" | "server", name: string, x: number, y: number, ip: string, gw?: string) {
      return b.add(model, name, x, y, (d) => {
        d.interfaces[0]!.ip = { address: ip, prefix: 24 };
        if (gw) d.defaultGateway = gw;
      });
    },
    cfg(name: string, iface: string, patch: Partial<Interface>) {
      Object.assign(port(find(name), iface), patch);
      return b;
    },
    link(a: string, ai: string, z: string, zi: string) {
      const da = find(a);
      const dz = find(z);
      t.links.push({ id: newId("l"), a: { device: da.id, iface: port(da, ai).id }, b: { device: dz.id, iface: port(dz, zi).id }, medium: "copper" });
      return b;
    },
    device: find,
  };
  return b;
}

export function createFromTemplate(id: TemplateId): Topology {
  switch (id) {
    case "blank":
      return emptyTopology();
    case "switched":
      return builder()
        .add("switch24", "SW1", 400, 160)
        .host("pc", "PC1", 220, 340, "192.168.1.10", "192.168.1.1")
        .host("pc", "PC2", 400, 360, "192.168.1.11", "192.168.1.1")
        .host("server", "SRV1", 580, 340, "192.168.1.20", "192.168.1.1")
        .link("PC1", "Ethernet0", "SW1", "FastEthernet0/1")
        .link("PC2", "Ethernet0", "SW1", "FastEthernet0/2")
        .link("SRV1", "Ethernet0", "SW1", "FastEthernet0/3").t;
    case "routed": {
      const b = builder()
        .add("router", "R1", 300, 160)
        .add("router", "R2", 560, 160)
        .host("pc", "PC1", 160, 340, "10.1.0.10", "10.1.0.1")
        .host("server", "SRV1", 700, 340, "10.2.0.10", "10.2.0.1")
        .cfg("R1", "GigabitEthernet0/0", { ip: { address: "10.1.0.1", prefix: 24 } })
        .cfg("R1", "GigabitEthernet0/1", { ip: { address: "172.16.0.1", prefix: 30 } })
        .cfg("R2", "GigabitEthernet0/1", { ip: { address: "172.16.0.2", prefix: 30 } })
        .cfg("R2", "GigabitEthernet0/0", { ip: { address: "10.2.0.1", prefix: 24 } })
        .link("PC1", "Ethernet0", "R1", "GigabitEthernet0/0")
        .link("R1", "GigabitEthernet0/1", "R2", "GigabitEthernet0/1")
        .link("R2", "GigabitEthernet0/0", "SRV1", "Ethernet0");
      b.device("R1").staticRoutes.push({ id: newId("r"), network: "10.2.0.0", prefix: 24, nextHop: "172.16.0.2", distance: 1 });
      b.device("R2").staticRoutes.push({ id: newId("r"), network: "10.1.0.0", prefix: 24, nextHop: "172.16.0.1", distance: 1 });
      return b.t;
    }
    case "vlans": {
      const b = builder()
        .add("router", "R1", 420, 100)
        .add("switch24", "SW1", 420, 260, (d) => d.vlans.push({ id: 10, name: "STAFF" }, { id: 20, name: "GUESTS" }))
        .host("pc", "PC10", 260, 420, "10.0.10.10", "10.0.10.1")
        .host("pc", "PC20", 580, 420, "10.0.20.10", "10.0.20.1")
        .cfg("SW1", "FastEthernet0/1", { accessVlan: 10 })
        .cfg("SW1", "FastEthernet0/2", { accessVlan: 20 })
        .cfg("SW1", "GigabitEthernet0/1", { mode: "trunk" })
        .link("PC10", "Ethernet0", "SW1", "FastEthernet0/1")
        .link("PC20", "Ethernet0", "SW1", "FastEthernet0/2")
        .link("SW1", "GigabitEthernet0/1", "R1", "GigabitEthernet0/0");
      const r1 = b.device("R1");
      const g0 = r1.interfaces.find((i) => i.name === "GigabitEthernet0/0")!;
      for (const vlan of [10, 20]) {
        const s = createSubinterface(r1, g0.id, vlan);
        s.ip = { address: `10.0.${vlan}.1`, prefix: 24 };
        r1.interfaces.push(s);
      }
      return b.t;
    }
    case "redundant":
      return builder()
        .add("switch24", "SW1", 420, 100, (d) => (d.stp.priority = 4096))
        .add("switch24", "SW2", 260, 280)
        .add("switch24", "SW3", 580, 280)
        .host("pc", "PC1", 180, 440, "192.168.1.10")
        .host("pc", "PC2", 660, 440, "192.168.1.11")
        .cfg("SW1", "GigabitEthernet0/1", { mode: "trunk" })
        .cfg("SW1", "GigabitEthernet0/2", { mode: "trunk" })
        .cfg("SW2", "GigabitEthernet0/1", { mode: "trunk" })
        .cfg("SW2", "GigabitEthernet0/2", { mode: "trunk" })
        .cfg("SW3", "GigabitEthernet0/1", { mode: "trunk" })
        .cfg("SW3", "GigabitEthernet0/2", { mode: "trunk" })
        .link("SW1", "GigabitEthernet0/1", "SW2", "GigabitEthernet0/1")
        .link("SW1", "GigabitEthernet0/2", "SW3", "GigabitEthernet0/1")
        .link("SW2", "GigabitEthernet0/2", "SW3", "GigabitEthernet0/2")
        .link("PC1", "Ethernet0", "SW2", "FastEthernet0/1")
        .link("PC2", "Ethernet0", "SW3", "FastEthernet0/1").t;
    case "ospf": {
      // Three routers in a triangle, OSPF area 0 everywhere: shut a link and watch traffic reroute.
      const b = builder()
        .add("router", "R1", 260, 140)
        .add("router", "R2", 560, 140)
        .add("router", "R3", 410, 330)
        .host("pc", "PC1", 100, 140, "10.1.0.10", "10.1.0.1")
        .host("server", "SRV1", 720, 140, "10.2.0.10", "10.2.0.1")
        .host("pc", "PC3", 410, 500, "10.3.0.10", "10.3.0.1");
      const ip = (d: string, i: string, address: string, prefix: number) => b.cfg(d, `GigabitEthernet${i}`, { ip: { address, prefix } });
      ip("R1", "0/0", "10.1.0.1", 24);
      ip("R2", "0/0", "10.2.0.1", 24);
      ip("R3", "0/0", "10.3.0.1", 24);
      ip("R1", "0/1", "10.0.12.1", 30);
      ip("R2", "0/1", "10.0.12.2", 30);
      ip("R2", "0/2", "10.0.23.1", 30);
      ip("R3", "0/2", "10.0.23.2", 30);
      ip("R1", "0/2", "10.0.13.1", 30);
      ip("R3", "0/1", "10.0.13.2", 30);
      b.link("PC1", "Ethernet0", "R1", "GigabitEthernet0/0")
        .link("SRV1", "Ethernet0", "R2", "GigabitEthernet0/0")
        .link("PC3", "Ethernet0", "R3", "GigabitEthernet0/0")
        .link("R1", "GigabitEthernet0/1", "R2", "GigabitEthernet0/1")
        .link("R2", "GigabitEthernet0/2", "R3", "GigabitEthernet0/2")
        .link("R1", "GigabitEthernet0/2", "R3", "GigabitEthernet0/1");
      for (const [name, id] of [["R1", "1.1.1.1"], ["R2", "2.2.2.2"], ["R3", "3.3.3.3"]] as const) {
        const d = b.device(name);
        d.protocols.ospf = { processId: 1, routerId: id, networks: [{ address: "10.0.0.0", wildcard: "0.255.255.255", area: 0 }], passive: [d.interfaces[0]!.id], costs: {} };
      }
      return b.t;
    }
    case "bgp": {
      // Two autonomous systems joined by eBGP; each announces its own LAN.
      const b = builder()
        .add("router", "R1", 300, 160)
        .add("router", "R2", 560, 160)
        .host("pc", "PC1", 160, 340, "10.1.0.10", "10.1.0.1")
        .host("server", "SRV1", 700, 340, "10.2.0.10", "10.2.0.1")
        .cfg("R1", "GigabitEthernet0/0", { ip: { address: "10.1.0.1", prefix: 24 } })
        .cfg("R1", "GigabitEthernet0/1", { ip: { address: "192.0.2.1", prefix: 30 } })
        .cfg("R2", "GigabitEthernet0/1", { ip: { address: "192.0.2.2", prefix: 30 } })
        .cfg("R2", "GigabitEthernet0/0", { ip: { address: "10.2.0.1", prefix: 24 } })
        .link("PC1", "Ethernet0", "R1", "GigabitEthernet0/0")
        .link("R1", "GigabitEthernet0/1", "R2", "GigabitEthernet0/1")
        .link("R2", "GigabitEthernet0/0", "SRV1", "Ethernet0");
      b.device("R1").protocols.bgp = { asn: 65001, neighbors: [{ address: "192.0.2.2", remoteAs: 65002 }], networks: [{ network: "10.1.0.0", prefix: 24 }] };
      b.device("R2").protocols.bgp = { asn: 65002, neighbors: [{ address: "192.0.2.1", remoteAs: 65001 }], networks: [{ network: "10.2.0.0", prefix: 24 }] };
      return b.t;
    }
    case "services": {
      // Office LAN on DHCP (relayed by R1), server LAN with a DHCP, DNS, web and file server.
      const b = builder()
        .add("router", "R1", 420, 140)
        .add("switch24", "SW1", 240, 300)
        .add("pc", "PC1", 120, 460, (d) => void (d.interfaces[0]!.dhcp = true))
        .add("pc", "PC2", 360, 460, (d) => void (d.interfaces[0]!.dhcp = true))
        .host("server", "SRV1", 620, 300, "10.2.0.10", "10.2.0.1")
        .cfg("R1", "GigabitEthernet0/0", { ip: { address: "10.1.0.1", prefix: 24 }, helperAddress: "10.2.0.10" })
        .cfg("R1", "GigabitEthernet0/1", { ip: { address: "10.2.0.1", prefix: 24 } })
        .link("R1", "GigabitEthernet0/0", "SW1", "GigabitEthernet0/1")
        .link("PC1", "Ethernet0", "SW1", "FastEthernet0/1")
        .link("PC2", "Ethernet0", "SW1", "FastEthernet0/2")
        .link("R1", "GigabitEthernet0/1", "SRV1", "Ethernet0");
      b.device("SRV1").dnsServers = ["10.2.0.10"];
      b.device("SRV1").services = {
        web: { enabled: true, title: "Intranet", body: "<h1>Welcome to the lab intranet</h1>" },
        dns: { enabled: true, records: [{ id: newId("n"), name: "intranet.lab.local", address: "10.2.0.10" }, { id: newId("n"), name: "files.lab.local", address: "10.2.0.10" }] },
        dhcp: { enabled: true, pools: [{ id: newId("p"), name: "OFFICE", network: "10.1.0.0", prefix: 24, start: "10.1.0.100", end: "10.1.0.199", gateway: "10.1.0.1", dns: "10.2.0.10" }] },
        files: { enabled: true, shares: [{ id: newId("s"), name: "Public", files: ["readme.txt", "network-plan.pdf"] }] },
      };
      return b.t;
    }
    case "ipsec": {
      // Two sites joined by a site-to-site VPN over an internet router that knows only public addresses.
      const b = builder()
        .add("router", "R1", 260, 160)
        .add("router", "ISP", 480, 100)
        .add("router", "R2", 700, 160)
        .host("pc", "PC1", 160, 340, "10.1.0.10", "10.1.0.1")
        .host("server", "SRV1", 800, 340, "10.2.0.10", "10.2.0.1")
        .cfg("R1", "GigabitEthernet0/0", { ip: { address: "10.1.0.1", prefix: 24 } })
        .cfg("R1", "GigabitEthernet0/1", { ip: { address: "203.0.113.1", prefix: 30 } })
        .cfg("ISP", "GigabitEthernet0/1", { ip: { address: "203.0.113.2", prefix: 30 } })
        .cfg("ISP", "GigabitEthernet0/2", { ip: { address: "198.51.100.1", prefix: 30 } })
        .cfg("R2", "GigabitEthernet0/1", { ip: { address: "198.51.100.2", prefix: 30 } })
        .cfg("R2", "GigabitEthernet0/0", { ip: { address: "10.2.0.1", prefix: 24 } })
        .link("PC1", "Ethernet0", "R1", "GigabitEthernet0/0")
        .link("R1", "GigabitEthernet0/1", "ISP", "GigabitEthernet0/1")
        .link("ISP", "GigabitEthernet0/2", "R2", "GigabitEthernet0/1")
        .link("R2", "GigabitEthernet0/0", "SRV1", "Ethernet0");
      const site = (name: string, gw: string, peer: string, local: string, remote: string) => {
        const d = b.device(name);
        d.staticRoutes.push({ id: newId("r"), network: "0.0.0.0", prefix: 0, nextHop: gw, distance: 1 });
        const any = (address: string) => ({ address, wildcard: "0.0.0.255" });
        d.acls.push({ name: "110", rules: [{ id: newId("a"), action: "permit", protocol: "ip", src: any(local), dst: any(remote) }] });
        const cfg: IpsecConfig = {
          policies: [{ priority: 10, encryption: "aes 256", hash: "sha256", authentication: "pre-share", group: 14, lifetime: 86400 }],
          keys: [{ key: "Lab-Secret1", address: peer }],
          transformSets: [{ name: "TS", transforms: ["esp-aes 256", "esp-sha-hmac"], mode: "tunnel" }],
          maps: [{ map: "VPN", seq: 10, peer, transformSets: ["TS"], acl: "110" }],
          interfaces: { [d.interfaces.find((i) => i.name === "GigabitEthernet0/1")!.id]: "VPN" },
        };
        d.protocols.ipsec = cfg;
      };
      site("R1", "203.0.113.2", "198.51.100.2", "10.1.0.0", "10.2.0.0");
      site("R2", "198.51.100.1", "203.0.113.1", "10.2.0.0", "10.1.0.0");
      return b.t;
    }
  }
}
