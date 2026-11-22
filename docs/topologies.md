# Topologies and the simulator

[Nederlands](topologies.nl.md)

## Building a network

1. Open **Topologies** and choose **New topology**. Pick a starter lab or a blank canvas.
2. Drag devices from the left strip onto the canvas (or click one to add it).
3. Choose **Cable** (or press `C`), click the first device and pick a port, then click
   the second device and pick a port. Cables between two switches become trunks.
4. Click a device to configure it on the right: IP addresses and gateway, ports
   (access/trunk, VLAN, shutdown), VLANs, static routes, ACLs, spanning tree.
5. Changes are saved automatically. `Ctrl+Z` / `Ctrl+Y` undo and redo, `Delete`
   removes the selection, the mouse wheel zooms and dragging the background pans.

Addresses can be typed as `192.168.1.10/24` or `192.168.1.10 255.255.255.0`.

## Testing

Choose **Ping**, **Traceroute** or **TCP connect** at the bottom, a source device and a
destination address, and press **Send**. Every frame crosses the cables as a dot:

| Colour | Meaning |
| --- | --- |
| Light blue | ARP |
| Coral | Echo request (ping) |
| Green | Echo reply |
| Amber | ICMP error (unreachable, TTL expired) |
| Purple | TCP |

A small number above a dot is the 802.1Q VLAN tag on a trunk. A red cross marks the
port where a packet was dropped; the **Result** tab explains where and why, and the
**Packet log** lists every frame. A grey cross is a port that spanning tree blocks
(expected on a redundant link). At the end the source device gets a green tick or a
red cross.

The **Tables** tab of a device shows its interfaces, routing table, ARP table, MAC
address table and spanning tree roles. **Clear tables** empties the ARP and MAC
tables so you can watch them being learned again.

The **configuration check** at the top right lists mistakes found without sending a
packet, such as duplicate IP addresses, a gateway outside the subnet, a native VLAN
mismatch or an access port in a VLAN that does not exist.

## What the engine simulates

- Ethernet switching with MAC learning, flooding and filtering per VLAN.
- Access and trunk ports, 802.1Q tags, native VLAN, allowed VLAN lists.
- Spanning tree (one tree for all VLANs): root bridge by priority and MAC, root and
  designated ports, alternate ports blocked. A loop without spanning tree causes a
  broadcast storm, which the simulator detects and stops.
- IPv4 with ARP, routed ports, subinterfaces (router on a stick), VLAN interfaces
  (SVI) on a multilayer switch, loopbacks, `ip routing` on or off.
- Static routes (also recursive), default gateways on hosts and switches.
- Extended ACLs (permit/deny, IP/ICMP/TCP/UDP, wildcards, ports) inbound and outbound;
  a denied packet is answered with "administratively prohibited".
- ICMP echo, time exceeded and unreachable; TCP connection attempts answered with
  SYN-ACK (open port on a server) or RST (closed port).

OSPF, BGP, the Cisco-style command line, Windows clients and servers follow in
phase 3; lessons and troubleshooting assignments in phase 4.

## Files

**Export** (top right in the editor) downloads the topology as a `.netsim.json` file.
**Import** on the topologies page creates a new topology from such a file. Topologies
are stored in the database and are part of every backup.
