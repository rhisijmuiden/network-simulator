/** Frames and packets as they travel through the simulated network. */

export const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";

export interface ArpPacket {
  kind: "arp";
  op: "request" | "reply";
  senderMac: string;
  senderIp: number;
  targetMac: string;
  targetIp: number;
}

export type IcmpMessage =
  | { type: "echo-request" | "echo-reply"; id: number; seq: number }
  | { type: "time-exceeded" | "unreachable"; code: UnreachableCode | "ttl"; original: Ipv4Packet };

export type UnreachableCode = "net" | "host" | "port" | "admin";

export interface TcpSegment {
  srcPort: number;
  dstPort: number;
  flags: "syn" | "syn-ack" | "rst" | "ack";
}

export interface UdpDatagram {
  srcPort: number;
  dstPort: number;
}

export interface Ipv4Packet {
  kind: "ipv4";
  src: number;
  dst: number;
  ttl: number;
  /** Identifies one simulated operation (ping, traceroute ...) so results can be matched. */
  flow: number;
  protocol: "icmp" | "tcp" | "udp" | "esp";
  icmp?: IcmpMessage;
  tcp?: TcpSegment;
  udp?: UdpDatagram;
  /** IPsec ESP: the encrypted original packet (tunnel mode). */
  esp?: { spi: number; inner: Ipv4Packet };
}

export interface Frame {
  /** Unique per transmission copy, used by the animation. */
  id: number;
  /** Operation this frame belongs to (ARP frames inherit it from the packet that caused them). */
  flow: number;
  src: string;
  dst: string;
  /** 802.1Q tag; undefined = untagged. */
  vlan?: number;
  payload: ArpPacket | Ipv4Packet;
}

/** What the UI needs to draw and describe a frame. */
export type FrameKind =
  | "arp-request"
  | "arp-reply"
  | "echo-request"
  | "echo-reply"
  | "time-exceeded"
  | "unreachable"
  | "tcp"
  | "udp"
  | "esp";

export interface FrameInfo {
  id: number;
  flow: number;
  kind: FrameKind;
  srcMac: string;
  dstMac: string;
  vlan?: number;
  srcIp?: string;
  dstIp?: string;
  ttl?: number;
  /** Short protocol detail, for example "SYN 80" or "seq 2". */
  detail?: string;
}
