# PCs and servers

## Network settings

In the side panel (General tab) a PC or server gets a fixed address and gateway, or
**Get an address automatically (DHCP)**. With DHCP the panel shows the lease, or why
there is none (no DHCP server answers, no pool for the network, pool full). The DNS
server can be set by hand; with DHCP it comes from the pool.

## Command prompt

Double-click a PC or server to open a command prompt in the style of Windows:

| Command | What it does |
| --- | --- |
| `ipconfig`, `ipconfig /all` | Address, mask, gateway, DHCP server and DNS servers. Without an answer from DHCP, Windows shows a 169.254.x.x address. |
| `ipconfig /renew`, `/release` | Show the lease (the simulator always has the converged state). |
| `ping [-n count] <host>` | Echo requests, animated on the canvas. Names are looked up in DNS first. |
| `tracert <host>` | Route to a host. |
| `arp -a` | ARP cache. |
| `nslookup <name> [server]` | DNS lookup. |
| `netsh interface ip set address "Ethernet0" static <ip> <mask> [gateway]` / `dhcp` | Change the address. |
| `netsh interface ip set dns "Ethernet0" static <server>` / `dhcp` | Change the DNS server. |
| `curl http://<host>/` | Fetch the page of a web server. |
| `net view \\<server>`, `dir \\<server>\<share>` | List shares and files of a file server. |
| `ftp <host>`, `telnet <host> <port>` | Test FTP or any TCP port. |
| `hostname`, `cls`, `help` | |

## Server services (Services tab)

- **Web server**: ports 80 and 443, with a page title and content (`curl`).
- **DNS server**: UDP 53, with name records.
- **DHCP server**: UDP 67, with pools (network, first and last address, gateway, DNS
  server). A client on the server's own network gets an address from the pool of that
  network. Clients elsewhere need a router interface with `ip helper-address <server>`
  in their network; the pool is chosen by the network of that router interface.
- **File sharing**: SMB (445) and FTP (21), with shares and file names.
- **Other open ports**: extra TCP ports.

Access lists apply to all of this: a `deny udp any any eq domain` on the path makes
`nslookup` time out. The configuration check warns about PCs that get no DHCP lease.
The starter lab "Office with services" has all of it set up.
