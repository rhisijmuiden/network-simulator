/**
 * The saved topology: plain JSON, versioned by `format`. Everything the simulator needs
 * to rebuild a network lives here; runtime state (MAC tables, ARP caches) does not.
 *
 * Phase 3 (Cisco-style CLI) reads and writes this same model: a `show running-config`
 * is a view of a Device, and configuration commands are edits to it.
 */

export const TOPOLOGY_FORMAT = 1;

export type DeviceKind = "router" | "switch" | "l3switch" | "pc" | "server";

export type InterfaceType = "ethernet" | "subinterface" | "svi" | "loopback";

/** routed: has its own IP (router port, host NIC, `no switchport`). access/trunk: a switchport. */
export type InterfaceMode = "routed" | "access" | "trunk";

export interface IpConfig {
  address: string;
  prefix: number;
}

export interface Interface {
  id: string;
  name: string;
  type: InterfaceType;
  /** Mbit/s, used for STP and OSPF costs. */
  speed: number;
  mac: string;
  enabled: boolean;
  description: string;
  mode: InterfaceMode;
  ip?: IpConfig;
  /** Switchport settings (mode access / trunk). */
  accessVlan: number;
  nativeVlan: number;
  /** "all" or a list such as "1,10-20". */
  allowedVlans: string;
  /** Subinterface: parent interface id. */
  parent?: string;
  /** Subinterface: 802.1Q tag (encapsulation dot1q). SVI: the VLAN it routes for. */
  vlan?: number;
  aclIn?: string;
  aclOut?: string;
  /** STP port cost override; derived from speed when absent. */
  stpCost?: number;
  /** Hosts: get the address, gateway and DNS server from a DHCP server. */
  dhcp?: boolean;
  /** Routers: forward DHCP broadcasts to this server (`ip helper-address`). */
  helperAddress?: string;
}

export interface StaticRoute {
  id: string;
  /** Network address, for example 10.1.0.0. */
  network: string;
  prefix: number;
  nextHop?: string;
  /** Exit interface id (for routes without a next hop, or both). */
  iface?: string;
  distance: number;
}

export interface Vlan {
  id: number;
  name: string;
}

export interface AddressMatch {
  address: string;
  /** Cisco wildcard: 0.0.0.0 = host, 255.255.255.255 = any. */
  wildcard: string;
}

export interface PortMatch {
  op: "eq" | "neq" | "lt" | "gt" | "range";
  from: number;
  to?: number;
}

export type AclProtocol = "ip" | "icmp" | "tcp" | "udp" | "esp";

export interface AclRule {
  id: string;
  action: "permit" | "deny";
  protocol: AclProtocol;
  src: AddressMatch;
  dst: AddressMatch;
  srcPort?: PortMatch;
  dstPort?: PortMatch;
  remark?: string;
}

export interface Acl {
  name: string;
  /** Standard lists match only the source address. Extended when absent. */
  type?: "standard" | "extended";
  rules: AclRule[];
}

export interface StpConfig {
  enabled: boolean;
  /** Bridge priority, multiple of 4096 (Cisco default 32768). */
  priority: number;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  /** Catalog model id, see catalog.ts. */
  model: string;
  name: string;
  x: number;
  y: number;
  interfaces: Interface[];
  /** Forward IP packets between interfaces (`ip routing`). */
  ipRouting: boolean;
  /** Hosts and L2 switches. */
  defaultGateway?: string;
  staticRoutes: StaticRoute[];
  vlans: Vlan[];
  stp: StpConfig;
  acls: Acl[];
  /** TCP ports this device accepts connections on (servers). */
  listenPorts: number[];
  /**
   * Settings for routing protocols and later features (OSPF, BGP, IPsec ...), keyed by
   * protocol id. The engine keeps them as-is; providers registered in routing.ts read them.
   */
  protocols: Record<string, unknown>;
  /** Hosts: DNS servers, in order. */
  dnsServers?: string[];
  /** Servers: the network services they run. */
  services?: Services;
}

export interface DhcpPool {
  id: string;
  name: string;
  /** Subnet the pool serves; a request is answered from the pool that contains the relay or server address. */
  network: string;
  prefix: number;
  /** First and last address handed out. */
  start: string;
  end: string;
  gateway?: string;
  dns?: string;
}

export interface Services {
  web?: { enabled: boolean; title: string; body: string };
  dns?: { enabled: boolean; records: { id: string; name: string; address: string }[] };
  dhcp?: { enabled: boolean; pools: DhcpPool[] };
  files?: { enabled: boolean; shares: { id: string; name: string; files: string[] }[] };
}

export interface Endpoint {
  device: string;
  iface: string;
}

export interface Link {
  id: string;
  a: Endpoint;
  b: Endpoint;
  medium: "copper" | "fiber";
}

export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface Topology {
  format: number;
  devices: Device[];
  links: Link[];
  notes: Note[];
}

export function emptyTopology(): Topology {
  return { format: TOPOLOGY_FORMAT, devices: [], links: [], notes: [] };
}

export const isSwitchport = (i: Interface) => (i.type === "ethernet" && (i.mode === "access" || i.mode === "trunk"));
export const isSwitch = (d: Device) => d.kind === "switch" || d.kind === "l3switch";
export const isHost = (d: Device) => d.kind === "pc" || d.kind === "server";
