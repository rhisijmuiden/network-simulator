import {
  createDevice,
  isSwitch,
  maskToPrefix,
  newId,
  nextDeviceName,
  parseIp,
  type Device,
  type Interface,
  type Link,
  type Topology,
} from "@netsim/engine";

/** Immutable edit: clones the topology, lets `fn` mutate the copy and returns it. */
export function edit(t: Topology, fn: (draft: Topology) => void): Topology {
  const draft = structuredClone(t);
  fn(draft);
  return draft;
}

export function findDevice(t: Topology, id: string | undefined): Device | undefined {
  return id ? t.devices.find((d) => d.id === id) : undefined;
}

export function findIface(d: Device | undefined, id: string | undefined): Interface | undefined {
  return d && id ? d.interfaces.find((i) => i.id === id) : undefined;
}

export function addDevice(t: Topology, model: string, x: number, y: number): { topology: Topology; id: string } {
  const d = createDevice(model, { name: nextDeviceName(model, t.devices.map((x) => x.name)), x: Math.round(x), y: Math.round(y) });
  return { topology: edit(t, (draft) => void draft.devices.push(d)), id: d.id };
}

export function updateDevice(t: Topology, id: string, fn: (d: Device) => void): Topology {
  return edit(t, (draft) => {
    const d = findDevice(draft, id);
    if (d) fn(d);
  });
}

export function updateIface(t: Topology, deviceId: string, ifaceId: string, fn: (i: Interface, d: Device) => void): Topology {
  return updateDevice(t, deviceId, (d) => {
    const i = findIface(d, ifaceId);
    if (i) fn(i, d);
  });
}

export function removeDevice(t: Topology, id: string): Topology {
  return edit(t, (draft) => {
    draft.devices = draft.devices.filter((d) => d.id !== id);
    draft.links = draft.links.filter((l) => l.a.device !== id && l.b.device !== id);
  });
}

export function removeIface(t: Topology, deviceId: string, ifaceId: string): Topology {
  return edit(t, (draft) => {
    const d = findDevice(draft, deviceId);
    if (!d) return;
    // Removing a parent also removes its subinterfaces.
    const gone = new Set([ifaceId, ...d.interfaces.filter((i) => i.parent === ifaceId).map((i) => i.id)]);
    d.interfaces = d.interfaces.filter((i) => !gone.has(i.id));
    d.staticRoutes = d.staticRoutes.filter((r) => !r.iface || !gone.has(r.iface));
    draft.links = draft.links.filter((l) => !gone.has(l.a.iface) && !gone.has(l.b.iface));
  });
}

export function usedPorts(t: Topology): Set<string> {
  return new Set(t.links.flatMap((l) => [l.a.iface, l.b.iface]));
}

/** Ports a cable can plug into: physical ethernet ports without a cable. */
export function freePorts(t: Topology, d: Device): Interface[] {
  const used = usedPorts(t);
  return d.interfaces.filter((i) => i.type === "ethernet" && !used.has(i.id));
}

export function addLink(t: Topology, a: { device: string; iface: string }, b: { device: string; iface: string }): Topology {
  const link: Link = { id: newId("l"), a, b, medium: "copper" };
  return edit(t, (draft) => {
    const da = findDevice(draft, a.device);
    const db = findDevice(draft, b.device);
    // Switch-to-switch cables become trunks, the usual choice in a lab.
    if (da && db && isSwitch(da) && isSwitch(db)) {
      for (const [d, e] of [[da, a], [db, b]] as const) {
        const i = findIface(d, e.iface);
        if (i && i.mode === "access") i.mode = "trunk";
      }
    }
    draft.links.push(link);
  });
}

export function removeLink(t: Topology, id: string): Topology {
  return edit(t, (draft) => void (draft.links = draft.links.filter((l) => l.id !== id)));
}

/** Accepts "10.0.0.1/24", "10.0.0.1 255.255.255.0" or "10.0.0.1" (prefix from fallback). */
export function parseAddressInput(text: string, fallbackPrefix = 24): { address: string; prefix: number } | null | "empty" {
  const s = text.trim();
  if (!s) return "empty";
  const m = /^(\d+\.\d+\.\d+\.\d+)\s*(?:\/\s*(\d{1,2})|\s+(\d+\.\d+\.\d+\.\d+))?$/.exec(s);
  if (!m || parseIp(m[1]!) === null) return null;
  let prefix = fallbackPrefix;
  if (m[2] !== undefined) prefix = Number(m[2]);
  else if (m[3] !== undefined) {
    const p = maskToPrefix(m[3]);
    if (p === null) return null;
    prefix = p;
  }
  if (prefix < 0 || prefix > 32) return null;
  return { address: m[1]!, prefix };
}

/** Topology without positions, so moving a device does not reset the running simulation. */
export function logicKey(t: Topology): string {
  return JSON.stringify({ d: t.devices.map(({ x: _x, y: _y, ...rest }) => rest), l: t.links });
}

export function allAddresses(t: Topology): { ip: string; label: string }[] {
  return t.devices.flatMap((d) => d.interfaces.filter((i) => i.ip).map((i) => ({ ip: i.ip!.address, label: `${d.name}` })));
}
