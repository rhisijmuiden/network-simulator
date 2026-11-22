# Site-to-site IPsec

Routers can build a site-to-site VPN with IKEv1 and crypto maps, configured in the
console as on a Cisco IOS router. Start with the **Site-to-site VPN** template: two
sites, an internet router (ISP) that only knows the public addresses, and a working
tunnel between R1 and R2.

## Configuration

```
crypto isakmp policy 10
 encryption aes 256
 hash sha256
 authentication pre-share
 group 14
crypto isakmp key Lab-Secret1 address 198.51.100.2
!
crypto ipsec transform-set TS esp-aes 256 esp-sha-hmac
 mode tunnel
!
access-list 110 permit ip 10.1.0.0 0.0.0.255 10.2.0.0 0.0.0.255
!
crypto map VPN 10 ipsec-isakmp
 set peer 198.51.100.2
 set transform-set TS
 match address 110
!
interface GigabitEthernet0/1
 crypto map VPN
```

The other router gets the same configuration with the addresses swapped: its own key for
the first router, `set peer` pointing back, and the crypto ACL mirrored
(`permit ip 10.2.0.0 0.0.0.255 10.1.0.0 0.0.0.255`).

| Command | Mode |
| --- | --- |
| `crypto isakmp policy <n>`: `encryption des\|3des\|aes [128\|192\|256]`, `hash md5\|sha\|sha256\|sha384\|sha512`, `authentication pre-share\|rsa-sig`, `group <n>`, `lifetime <s>` | global, then `(config-isakmp)` |
| `crypto isakmp key <key> address <peer> [mask]` | global |
| `crypto ipsec transform-set <name> <transforms>`, `mode tunnel\|transport` | global, then `(cfg-crypto-trans)` |
| `crypto map <name> <seq> ipsec-isakmp`: `set peer`, `set transform-set`, `match address`, `set pfs group<n>` | global, then `(config-crypto-map)` |
| `crypto map <name>` | interface |
| `show crypto isakmp sa`, `show crypto isakmp policy`, `show crypto ipsec sa`, `show crypto ipsec transform-set`, `show crypto map`, `show crypto session` | privileged |
| `ping <ip> source <interface>` | privileged: test the tunnel from the router itself, from its LAN address |
| `clear crypto sa` | privileged: resets the packet counters |

IOS defaults apply to a new ISAKMP policy (des, sha, rsa-sig, group 1, 86400 seconds).
Because the simulator has no certificates, use `authentication pre-share`.

## How the simulator handles it

- The tunnel is computed in its converged state, as the routing protocols are: it is up
  when both ends agree and can reach each other. There is no IKE traffic to watch.
- A packet that leaves an interface with a crypto map and matches a `permit` in the
  crypto ACL is wrapped in ESP and sent to the peer. On the canvas ESP packets are gold;
  the internet router in between only sees the public addresses.
- The peer unwraps the packet and routes the original on. Plain packets that should have
  come through the tunnel are dropped.
- Traceroute does not show the routers inside the tunnel. The far VPN router answers from
  its outside address, which the crypto ACL does not cover, so that hop shows `*`, just
  as on real equipment.
- An inbound access list on the outside interface must let IKE (`udp eq isakmp`) and
  `esp` from the peer through.

## Why a tunnel stays down

The diagnostics panel, the Routes tab in the side panel and `show crypto session` name
the reason:

| Reason | What to check |
| --- | --- |
| Incomplete | The crypto map entry needs `set peer`, `set transform-set` and `match address`, and the ACL and transform set must exist. |
| Peer unreachable | A route to the peer's public address, on both sides. |
| No crypto map at peer / peer points elsewhere | The peer address is the interface where the other crypto map is applied, and that map's `set peer` points back. |
| Blocked by ACL | Permit `udp eq isakmp` and `esp` between the peers. |
| Phase 1 policy mismatch | Encryption, hash, authentication and group must match in a policy on both sides. |
| Key mismatch | The same pre-shared key on both sides, each for the other's address. |
| Phase 2 mismatch | A transform set with the same transforms and mode, and the same PFS group. |
| Crypto ACL not mirrored | The ACLs must be mirror images of each other. |
