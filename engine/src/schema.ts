import { z } from "zod";
import { isIp } from "./ip.js";
import { TOPOLOGY_FORMAT, type Topology } from "./model.js";

/** Validation for topologies that come from the API or an imported file. */

const id = z.string().min(1).max(64);
const ip = z.string().refine(isIp, "invalid IPv4 address");
const vlanId = z.number().int().min(1).max(4094);
const text = (max: number) => z.string().max(max);

const portMatch = z.object({ op: z.enum(["eq", "neq", "lt", "gt", "range"]), from: z.number().int().min(0).max(65535), to: z.number().int().min(0).max(65535).optional() });
const addressMatch = z.object({ address: ip, wildcard: ip });

export const InterfaceSchema = z.object({
  id,
  name: text(64).min(1),
  type: z.enum(["ethernet", "subinterface", "svi", "loopback"]),
  speed: z.number().int().min(1).max(400000),
  mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/),
  enabled: z.boolean(),
  description: text(200).default(""),
  mode: z.enum(["routed", "access", "trunk"]),
  ip: z.object({ address: ip, prefix: z.number().int().min(0).max(32) }).optional(),
  accessVlan: vlanId.default(1),
  nativeVlan: vlanId.default(1),
  allowedVlans: text(200).default("all"),
  parent: id.optional(),
  vlan: vlanId.optional(),
  aclIn: text(64).optional(),
  aclOut: text(64).optional(),
  stpCost: z.number().int().min(1).max(200000000).optional(),
  dhcp: z.boolean().optional(),
  helperAddress: ip.optional(),
});

const ServicesSchema = z.object({
  web: z.object({ enabled: z.boolean(), title: text(200), body: text(5000) }).optional(),
  dns: z.object({ enabled: z.boolean(), records: z.array(z.object({ id, name: text(253).min(1), address: ip })).max(500) }).optional(),
  dhcp: z
    .object({
      enabled: z.boolean(),
      pools: z
        .array(
          z.object({ id, name: text(64).min(1), network: ip, prefix: z.number().int().min(0).max(32), start: ip, end: ip, gateway: ip.optional(), dns: ip.optional() }),
        )
        .max(50),
    })
    .optional(),
  files: z.object({ enabled: z.boolean(), shares: z.array(z.object({ id, name: text(80).min(1), files: z.array(text(200)).max(200) })).max(50) }).optional(),
});

export const DeviceSchema = z.object({
  id,
  kind: z.enum(["router", "switch", "l3switch", "pc", "server"]),
  model: text(64),
  name: text(64).min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  interfaces: z.array(InterfaceSchema).max(512),
  ipRouting: z.boolean(),
  defaultGateway: ip.optional(),
  staticRoutes: z
    .array(z.object({ id, network: ip, prefix: z.number().int().min(0).max(32), nextHop: ip.optional(), iface: id.optional(), distance: z.number().int().min(1).max(255).default(1) }))
    .max(256)
    .default([]),
  vlans: z.array(z.object({ id: vlanId, name: text(64) })).max(4094).default([]),
  stp: z.object({ enabled: z.boolean(), priority: z.number().int().min(0).max(61440) }).default({ enabled: false, priority: 32768 }),
  acls: z
    .array(
      z.object({
        name: text(64).min(1),
        type: z.enum(["standard", "extended"]).optional(),
        rules: z
          .array(
            z.object({
              id,
              action: z.enum(["permit", "deny"]),
              protocol: z.enum(["ip", "icmp", "tcp", "udp"]),
              src: addressMatch,
              dst: addressMatch,
              srcPort: portMatch.optional(),
              dstPort: portMatch.optional(),
              remark: text(200).optional(),
            }),
          )
          .max(500),
      }),
    )
    .max(100)
    .default([]),
  listenPorts: z.array(z.number().int().min(1).max(65535)).max(100).default([]),
  protocols: z.record(z.string(), z.unknown()).default({}),
  dnsServers: z.array(ip).max(4).optional(),
  services: ServicesSchema.optional(),
});

export const TopologySchema = z.object({
  format: z.literal(TOPOLOGY_FORMAT),
  devices: z.array(DeviceSchema).max(500),
  links: z
    .array(z.object({ id, a: z.object({ device: id, iface: id }), b: z.object({ device: id, iface: id }), medium: z.enum(["copper", "fiber"]).default("copper") }))
    .max(2000),
  notes: z.array(z.object({ id, x: z.number().finite(), y: z.number().finite(), text: text(2000) })).max(200).default([]),
});

/**
 * Validates and normalises a topology. Throws a ZodError for bad structure and an Error with
 * a code (topology.*) for broken references.
 */
export function parseTopology(input: unknown): Topology {
  const t = TopologySchema.parse(input) as Topology;
  const devices = new Map(t.devices.map((d) => [d.id, d]));
  if (devices.size !== t.devices.length) throw new Error("topology.duplicateId");
  const used = new Set<string>();
  for (const l of t.links) {
    for (const end of [l.a, l.b]) {
      const d = devices.get(end.device);
      const i = d?.interfaces.find((x) => x.id === end.iface);
      if (!i || i.type !== "ethernet") throw new Error("topology.badLink");
      if (used.has(i.id)) throw new Error("topology.portInUse");
      used.add(i.id);
    }
  }
  return t;
}
