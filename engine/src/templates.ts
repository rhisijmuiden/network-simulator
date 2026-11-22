import { createDevice, createSubinterface, newId } from "./catalog.js";
import { emptyTopology, type Device, type Interface, type Topology } from "./model.js";

/** Starter topologies offered when creating a new one. Names are i18n keys `templates.<id>`. */
export const TEMPLATE_IDS = ["blank", "switched", "routed", "vlans", "redundant"] as const;
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
  }
}
