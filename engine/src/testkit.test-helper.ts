import { createDevice, createSubinterface, createSvi, newId } from "./catalog.js";
import { emptyTopology, type Device, type Interface, type Topology } from "./model.js";

/** Small builder for tests: lab().add("router","R1").link("R1","Gi0/0","PC1","Ethernet0") */
export function lab() {
  const t: Topology = emptyTopology();
  const dev = (name: string) => {
    const d = t.devices.find((x) => x.name === name);
    if (!d) throw new Error(`no device ${name}`);
    return d;
  };
  const ifc = (d: Device, name: string): Interface => {
    const i = d.interfaces.find((x) => x.name === name || x.name.endsWith(name));
    if (!i) throw new Error(`no interface ${name} on ${d.name}`);
    return i;
  };
  const api = {
    t,
    dev,
    ifc: (device: string, name: string) => ifc(dev(device), name),
    add(model: string, name: string, fn?: (d: Device) => void) {
      const d = createDevice(model, { name, x: 0, y: 0 });
      fn?.(d);
      t.devices.push(d);
      return api;
    },
    host(model: "pc" | "server", name: string, ip: string, prefix: number, gw?: string) {
      return api.add(model, name, (d) => {
        d.interfaces[0]!.ip = { address: ip, prefix };
        if (gw) d.defaultGateway = gw;
      });
    },
    ip(device: string, iface: string, address: string, prefix: number) {
      ifc(dev(device), iface).ip = { address, prefix };
      return api;
    },
    set(device: string, iface: string, patch: Partial<Interface>) {
      Object.assign(ifc(dev(device), iface), patch);
      return api;
    },
    sub(device: string, parent: string, vlan: number, address: string, prefix: number) {
      const d = dev(device);
      const s = createSubinterface(d, ifc(d, parent).id, vlan);
      s.ip = { address, prefix };
      d.interfaces.push(s);
      return api;
    },
    svi(device: string, vlan: number, address: string, prefix: number) {
      const d = dev(device);
      let s = d.interfaces.find((i) => i.type === "svi" && i.vlan === vlan);
      if (!s) d.interfaces.push((s = createSvi(vlan)));
      s.ip = { address, prefix };
      return api;
    },
    vlan(device: string, ...ids: number[]) {
      const d = dev(device);
      for (const id of ids) if (!d.vlans.some((v) => v.id === id)) d.vlans.push({ id, name: `VLAN${id}` });
      return api;
    },
    route(device: string, network: string, prefix: number, nextHop: string) {
      dev(device).staticRoutes.push({ id: newId("r"), network, prefix, nextHop, distance: 1 });
      return api;
    },
    link(a: string, ai: string, b: string, bi: string) {
      const da = dev(a);
      const db = dev(b);
      t.links.push({ id: newId("l"), a: { device: da.id, iface: ifc(da, ai).id }, b: { device: db.id, iface: ifc(db, bi).id }, medium: "copper" });
      return api;
    },
  };
  return api;
}
