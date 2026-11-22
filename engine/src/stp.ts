import { isSwitch, isSwitchport, type Device, type Interface } from "./model.js";
import type { NetworkIndex } from "./network.js";

export type StpRole = "root" | "designated" | "alternate" | "edge" | "disabled";
export type StpState = "forwarding" | "blocking";

export interface StpPort {
  role: StpRole;
  state: StpState;
  cost: number;
}

export interface StpBridge {
  /** Device id of the root bridge of this bridge's tree. */
  root: string;
  rootCost: number;
  bridgeId: string;
  rootPort?: string;
}

/** IEEE short path costs, as Cisco uses by default. */
export function stpCost(iface: Interface): number {
  if (iface.stpCost) return iface.stpCost;
  if (iface.speed >= 10000) return 2;
  if (iface.speed >= 1000) return 4;
  if (iface.speed >= 100) return 19;
  return 100;
}

const bridgeMac = (d: Device) => d.interfaces.find((i) => i.type === "ethernet")?.mac ?? "ff:ff:ff:ff:ff:ff";
const bridgeId = (d: Device) => `${d.stp.priority.toString().padStart(5, "0")}.${bridgeMac(d)}`;

interface Edge {
  local: Interface;
  remote: Interface;
  neighbor: Device;
}

/**
 * Computes the converged result of a single spanning tree (802.1D/CST) over all STP-enabled
 * switches, the way the protocol would settle: elect the root bridge (lowest priority, then
 * MAC), pick root ports by lowest path cost, one designated port per segment, block the rest.
 * Per-VLAN trees (PVST+) and timers are left for a later phase.
 */
export function computeStp(net: NetworkIndex): { ports: Map<string, StpPort>; bridges: Map<string, StpBridge> } {
  const ports = new Map<string, StpPort>();
  const bridges = new Map<string, StpBridge>();
  const stpBridges = [...net.devices.values()].filter((d) => isSwitch(d) && d.stp.enabled);
  const edges = new Map<string, Edge[]>();

  for (const d of net.devices.values()) {
    if (!isSwitch(d)) continue;
    for (const p of d.interfaces) {
      if (!isSwitchport(p)) continue;
      const cost = stpCost(p);
      if (!net.isUp(p)) {
        ports.set(p.id, { role: "disabled", state: "forwarding", cost });
        continue;
      }
      const peer = net.peer(p.id)!;
      const runsStp = d.stp.enabled && isSwitch(peer.device) && peer.device.stp.enabled && isSwitchport(peer.iface);
      ports.set(p.id, { role: runsStp ? "designated" : "edge", state: "forwarding", cost });
      if (runsStp) {
        const list = edges.get(d.id) ?? [];
        list.push({ local: p, remote: peer.iface, neighbor: peer.device });
        edges.set(d.id, list);
      }
    }
  }

  const ids = new Map(stpBridges.map((d) => [d.id, bridgeId(d)]));
  const portIndex = (d: Device, i: Interface) => d.interfaces.indexOf(i);
  const seen = new Set<string>();

  for (const start of stpBridges) {
    if (seen.has(start.id)) continue;
    // Connected component of bridges.
    const component: Device[] = [];
    const stack = [start];
    seen.add(start.id);
    while (stack.length) {
      const d = stack.pop()!;
      component.push(d);
      for (const e of edges.get(d.id) ?? []) {
        if (!seen.has(e.neighbor.id)) {
          seen.add(e.neighbor.id);
          stack.push(e.neighbor);
        }
      }
    }
    const root = component.reduce((a, b) => (ids.get(b.id)! < ids.get(a.id)! ? b : a));

    // Dijkstra from the root over port costs (cost is counted on the receiving bridge's port).
    const dist = new Map<string, number>([[root.id, 0]]);
    const done = new Set<string>();
    while (done.size < component.length) {
      let best: Device | undefined;
      for (const d of component) if (!done.has(d.id) && dist.has(d.id) && (!best || dist.get(d.id)! < dist.get(best.id)!)) best = d;
      if (!best) break;
      done.add(best.id);
      for (const e of edges.get(best.id) ?? []) {
        const nd = dist.get(best.id)! + stpCost(e.remote);
        if (nd < (dist.get(e.neighbor.id) ?? Infinity)) dist.set(e.neighbor.id, nd);
      }
    }

    for (const d of component) {
      const myDist = dist.get(d.id) ?? Infinity;
      let rootPort: Edge | undefined;
      if (d.id !== root.id) {
        const key = (e: Edge) =>
          [stpCost(e.local) + (dist.get(e.neighbor.id) ?? Infinity), ids.get(e.neighbor.id)!, portIndex(e.neighbor, e.remote)] as const;
        for (const e of edges.get(d.id) ?? []) {
          if (!rootPort) rootPort = e;
          else {
            const [c1, b1, p1] = key(e);
            const [c2, b2, p2] = key(rootPort);
            if (c1 < c2 || (c1 === c2 && (b1 < b2 || (b1 === b2 && p1 < p2)))) rootPort = e;
          }
        }
      }
      bridges.set(d.id, { root: root.id, rootCost: myDist, bridgeId: ids.get(d.id)!, rootPort: rootPort?.local.id });
      for (const e of edges.get(d.id) ?? []) {
        const port = ports.get(e.local.id)!;
        if (e === rootPort) {
          port.role = "root";
          continue;
        }
        // Designated on this segment if our (root cost, bridge id, port id) beats the neighbour's.
        const nDist = dist.get(e.neighbor.id) ?? Infinity;
        const mine = [myDist, ids.get(d.id)!, portIndex(d, e.local)] as const;
        const theirs = [nDist, ids.get(e.neighbor.id)!, portIndex(e.neighbor, e.remote)] as const;
        const weWin = mine[0] < theirs[0] || (mine[0] === theirs[0] && (mine[1] < theirs[1] || (mine[1] === theirs[1] && mine[2] < theirs[2])));
        if (!weWin) {
          port.role = "alternate";
          port.state = "blocking";
        }
      }
    }
  }
  return { ports, bridges };
}
