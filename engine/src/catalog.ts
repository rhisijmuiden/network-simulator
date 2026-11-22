import type { Device, DeviceKind, Interface, InterfaceMode, InterfaceType } from "./model.js";

/** Device models that can be placed on the canvas. Phase 3 adds more (for example a modular chassis switch). */
export interface DeviceModel {
  id: string;
  kind: DeviceKind;
  /** i18n key suffix for the model name, shown as `catalog.<id>`. */
  label: string;
  /** Prefix for new device names, such as R, SW, PC. */
  namePrefix: string;
  ports: { prefix: string; slots: string[]; speed: number; module?: string }[];
  /** Line shown by `show version`. */
  platform: string;
}

const range = (from: number, to: number, fmt: (n: number) => string) =>
  Array.from({ length: to - from + 1 }, (_, i) => fmt(from + i));

export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: "router",
    kind: "router",
    label: "router",
    namePrefix: "R",
    ports: [{ prefix: "GigabitEthernet", slots: range(0, 3, (n) => `0/${n}`), speed: 1000 }],
    platform: "NS-R4G integrated services router, 4 gigabit Ethernet interfaces",
  },
  {
    id: "switch24",
    kind: "switch",
    label: "switch24",
    namePrefix: "SW",
    ports: [
      { prefix: "FastEthernet", slots: range(1, 24, (n) => `0/${n}`), speed: 100 },
      { prefix: "GigabitEthernet", slots: range(1, 2, (n) => `0/${n}`), speed: 1000 },
    ],
    platform: "NS-S24 access switch, 24 fast Ethernet + 2 gigabit uplinks",
  },
  {
    id: "l3switch24",
    kind: "l3switch",
    label: "l3switch24",
    namePrefix: "MLS",
    ports: [
      { prefix: "GigabitEthernet", slots: range(1, 24, (n) => `1/0/${n}`), speed: 1000 },
      { prefix: "TenGigabitEthernet", slots: range(1, 2, (n) => `1/1/${n}`), speed: 10000 },
    ],
    platform: "NS-L3-24 multilayer switch, 24 gigabit + 2 ten-gigabit ports",
  },
  {
    // Modular chassis in the style of a Catalyst 6500: line cards per slot, supervisor in slot 5.
    id: "chassis6500",
    kind: "l3switch",
    label: "chassis6500",
    namePrefix: "CORE",
    ports: [
      { prefix: "GigabitEthernet", slots: range(1, 48, (n) => `1/${n}`), speed: 1000, module: "48-port 10/100/1000 Ethernet line card" },
      { prefix: "TenGigabitEthernet", slots: range(1, 8, (n) => `2/${n}`), speed: 10000, module: "8-port 10 gigabit Ethernet line card" },
      { prefix: "GigabitEthernet", slots: range(1, 2, (n) => `5/${n}`), speed: 1000, module: "Supervisor engine, 2 gigabit uplinks" },
    ],
    platform: "NS-6509 modular chassis switch (6500-style), 9 slots",
  },
  { id: "pc", kind: "pc", label: "pc", namePrefix: "PC", ports: [{ prefix: "Ethernet", slots: ["0"], speed: 1000 }], platform: "Workstation" },
  { id: "server", kind: "server", label: "server", namePrefix: "SRV", ports: [{ prefix: "Ethernet", slots: ["0", "1"], speed: 1000 }], platform: "Server" },
];

export function getModel(id: string): DeviceModel | undefined {
  return DEVICE_MODELS.find((m) => m.id === id);
}

let counter = 0;
/** Short random id; good enough for objects inside one topology (no secure context needed). */
export function newId(prefix = ""): string {
  counter = (counter + 1) % 1296;
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + counter.toString(36).padStart(2, "0");
}

/** Random locally administered unicast MAC address. */
export function newMac(): string {
  const bytes = [0x02, ...Array.from({ length: 5 }, () => Math.floor(Math.random() * 256))];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
}

const SHORT: [string, string][] = [
  ["TenGigabitEthernet", "Te"],
  ["GigabitEthernet", "Gi"],
  ["FastEthernet", "Fa"],
  ["Ethernet", "Eth"],
  ["Loopback", "Lo"],
  ["Vlan", "Vlan"],
];

/** GigabitEthernet0/1 -> Gi0/1 */
export function shortName(name: string): string {
  for (const [long, short] of SHORT) if (name.startsWith(long)) return short + name.slice(long.length);
  return name;
}

function makeInterface(name: string, type: InterfaceType, mode: InterfaceMode, speed: number, extra: Partial<Interface> = {}): Interface {
  return {
    id: newId("if"),
    name,
    type,
    speed,
    mac: newMac(),
    enabled: true,
    description: "",
    mode,
    accessVlan: 1,
    nativeVlan: 1,
    allowedVlans: "all",
    ...extra,
  };
}

export function createDevice(modelId: string, opts: { name: string; x: number; y: number }): Device {
  const model = getModel(modelId);
  if (!model) throw new Error(`unknown model ${modelId}`);
  const switchLike = model.kind === "switch" || model.kind === "l3switch";
  const interfaces: Interface[] = model.ports.flatMap((p) =>
    p.slots.map((s) => makeInterface(p.prefix + s, "ethernet", switchLike ? "access" : "routed", p.speed)),
  );
  if (switchLike) interfaces.push(makeInterface("Vlan1", "svi", "routed", 1000, { vlan: 1 }));
  return {
    id: newId("d"),
    kind: model.kind,
    model: model.id,
    name: opts.name,
    x: opts.x,
    y: opts.y,
    interfaces,
    ipRouting: model.kind === "router" || model.kind === "l3switch",
    staticRoutes: [],
    vlans: switchLike ? [{ id: 1, name: "default" }] : [],
    stp: { enabled: switchLike, priority: 32768 },
    acls: [],
    listenPorts: model.kind === "server" ? [80, 443] : [],
    protocols: {},
  };
}

/** Next free name such as R3 for the given model. */
export function nextDeviceName(modelId: string, existing: string[]): string {
  const prefix = getModel(modelId)?.namePrefix ?? "D";
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (let i = 1; ; i++) if (!taken.has(`${prefix}${i}`.toLowerCase())) return `${prefix}${i}`;
}

/** Subinterface `<parent>.<number>`; the 802.1Q tag defaults to the number (the CLI sets it with `encapsulation dot1Q`). */
export function createSubinterface(device: Device, parentId: string, number: number, vlan: number | undefined = number): Interface {
  const parent = device.interfaces.find((i) => i.id === parentId);
  if (!parent) throw new Error("unknown parent interface");
  return makeInterface(`${parent.name}.${number}`, "subinterface", "routed", parent.speed, { parent: parent.id, vlan, mac: parent.mac });
}

export function createSvi(vlan: number): Interface {
  return makeInterface(`Vlan${vlan}`, "svi", "routed", 1000, { vlan });
}

export function createLoopback(device: Device, number?: number): Interface {
  const used = new Set(device.interfaces.filter((i) => i.type === "loopback").map((i) => i.name));
  let n = number ?? 0;
  if (number === undefined) while (used.has(`Loopback${n}`)) n++;
  return makeInterface(`Loopback${n}`, "loopback", "routed", 8000);
}
