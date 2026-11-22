# Device console

Every router and switch has an IOS-style command line, written from scratch in the
engine (`engine/src/cli/`). No real Cisco software is used.

## Opening it

Open a topology and double-click a router or switch, or select it and click the
terminal icon in the side panel. Each device gets its own tab in the console window.
Configuration commands change the topology right away: they are autosaved and each
command is one undo step in the editor. `ping` and `traceroute` are animated on the
canvas.

## Keys

| Key | Effect |
| --- | --- |
| `?` | Lists what can follow (`show ?`, `sh?`) |
| Tab | Completes the keyword |
| Arrow up / down, Ctrl+P / Ctrl+N | Command history |
| Ctrl+Z, Ctrl+C | Back to privileged EXEC |
| Ctrl+L | Clear the screen |

Keywords may be abbreviated to any unique prefix (`sh ip int br`). Errors use the
IOS wording and a `^` marker under the wrong word.

## Modes and commands

- **User EXEC** (`R1>`): `enable`, `show …`, `ping`, `traceroute`.
- **Privileged EXEC** (`R1#`): `configure terminal`, `show running-config`,
  `copy running-config startup-config`, `write`, `clear arp-cache`,
  `clear mac address-table dynamic`.
- **Global configuration** (`(config)#`): `hostname`, `interface`, `interface range`,
  `vlan`, `ip routing`, `ip default-gateway`, `ip route` (next hop, exit interface,
  distance), `ip access-list standard|extended`, `access-list 1-199`,
  `spanning-tree vlan … priority`. `do <command>` runs an EXEC command; `no` undoes.
- **Interface** (`(config-if)#`): `ip address`, `shutdown`, `description`,
  `switchport mode access|trunk`, `switchport access vlan`,
  `switchport trunk native vlan`, `switchport trunk allowed vlan [add|remove]`,
  `no switchport` (multilayer switches), `encapsulation dot1Q` (subinterfaces),
  `ip access-group … in|out`, `spanning-tree cost`.
  `interface vlan 10`, `interface loopback 0` and `interface g0/0.10` create the
  interface when it does not exist.
- **VLAN** (`(config-vlan)#`): `name`.
- **Access list** (`(config-ext-nacl)#`, `(config-std-nacl)#`): `permit`, `deny`,
  sequence numbers, `no <seq>`, `remark`.

Show commands: `show running-config`, `show ip interface brief`, `show interfaces`,
`show interfaces trunk`, `show ip route`, `show arp`, `show mac address-table`,
`show vlan brief`, `show spanning-tree`, `show access-lists`, `show cdp neighbors`,
`show version`, `show module` (chassis line cards), `show history`.

Commands that have no effect in the simulator (passwords, banners, `line vty`,
`speed`, `duplex`) are accepted so that configurations from real labs can be pasted.

## OSPF and BGP

Both run in their converged state: as soon as the configuration is complete, the
routing tables are as they would be after the protocols settle.

**OSPF** (`router ospf <process-id>`)

- `network <address> <wildcard> area <id>` enables OSPF on the interfaces it matches;
  `router-id`, `passive-interface <interface>`, `default-information originate`
  (needs a static default route on that router).
- Interface: `ip ospf cost <1-65535>`. The default cost uses a 100 Mb/s reference.
- Neighbours form over a shared segment (also through switches and VLANs) when the
  area, subnet and mask match, neither side is passive and the router IDs differ.
  Loopbacks are announced as /32.
- Routes: `O`, `O IA` (another area) and `O*E2` (default route).
- Show: `show ip ospf neighbor`, `show ip ospf interface brief`, `show ip ospf` (also
  lists routers that are on the segment but do not become neighbours, and why),
  `show ip protocols`, `show ip route ospf`.

**BGP** (`router bgp <as>`)

- `neighbor <address> remote-as <as>`, `neighbor <address> next-hop-self`,
  `network <address> mask <mask>` (the network must be in the routing table with
  exactly that mask), `bgp router-id`.
- A session comes up when both sides point at each other with the right AS numbers
  and can reach each other; eBGP neighbours must be directly connected.
- Paths follow the usual rules: AS-path loop check, no iBGP-to-iBGP re-advertising,
  next hop unchanged towards iBGP peers unless `next-hop-self`, best path by shortest
  AS path, then eBGP over iBGP. eBGP routes have distance 20, iBGP 200.
- Show: `show ip bgp summary`, `show ip bgp`, `show ip route bgp`.

The side panel (Routes tab) shows the OSPF neighbours and BGP sessions of a device,
with the reason when one does not come up. The starter labs "OSPF triangle" and
"Two networks with BGP" are ready to experiment with.

## Extending

Routing protocols add modes and commands with `registerCliExtension` in
`engine/src/cli/ios.ts`, next to `registerRoutingProtocol`.
