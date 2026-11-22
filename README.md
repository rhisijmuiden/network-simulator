# Network Simulator

**A web-based network simulation and learning platform.** Build networks with
virtual Cisco-style routers and switches, configure them from the command line,
and watch the traffic flow as animated packets, so you see at a glance what
works and what does not.

[Nederlands](README.nl.md)

> **Status:** phase 2 of 4. The foundation and the simulation engine with its
> topology editor are done; device CLIs and lessons follow (see the roadmap).

## Roadmap

| Phase | What | Status |
| --- | --- | --- |
| 1 | Foundation: users, mail server, encrypted backups, updates from the UI, English and Dutch | Done |
| 2 | Simulation engine, visual topology editor, animated traffic flows | Done |
| 3 | Cisco-style router and switch CLI built from scratch (incl. Catalyst 6500 style): VLANs, trunks, static routing, OSPF, BGP, ACLs, later IPsec. Windows workstations and web/file servers | In progress: the CLI, browser console, OSPF and BGP are done ([docs/console.md](docs/console.md)) |
| 4 | Lessons and troubleshooting assignments with automatic checks | Planned |

No real Cisco images are used: every device is simulated by the platform's own engine.

## What phase 2 contains

- **Topology editor**: drag routers, switches, a multilayer switch, PCs and servers
  onto the canvas, draw cables port to port, undo/redo, autosave, import/export as
  a file, and starter labs (one switch, two routers, VLANs, redundant switches).
- **Own simulation engine** (`engine/`, TypeScript, also used by the server):
  Ethernet switching with MAC learning, VLANs, access and trunk ports (802.1Q,
  native VLAN), spanning tree (root bridge election, blocked ports), IPv4 with ARP,
  routed ports, router-on-a-stick subinterfaces, VLAN interfaces (SVI), static
  routes, extended ACLs (IP/ICMP/TCP/UDP with ports) and a hook for OSPF and BGP.
- **Tests with animation**: ping, traceroute and TCP connect. Every frame moves as
  a coloured dot over the cables; drops show a red cross on the exact port with the
  reason ("no route to 10.2.0.10", "VLAN 20 does not exist on this switch").
- **Device tables** like `show` commands: interfaces, routing table, ARP table, MAC
  address table and spanning tree roles.
- **Configuration check** that finds common mistakes before you send a packet:
  duplicate IPs, gateway outside the subnet, native VLAN mismatch and more.
  See [docs/topologies.md](docs/topologies.md).

## What phase 1 contains

- **Modern web interface** in the RHIS house style (see [`brand/`](brand)), menu on
  the left, light and dark theme, works on phones.
- **English and Dutch**, per user and switchable in the top bar.
- **Users and roles**: administrator, instructor, student. One-time passwords,
  forced password change, audit log.
- **Mail server**: your own SMTP server with STARTTLS (required) or implicit TLS,
  minimum TLS 1.2/1.3, certificate verification, LOGIN/PLAIN/CRAM-MD5, optional
  DKIM signing and a test button. Used for alerts such as a failed backup.
- **Backup and restore**: full and incremental backups to **SCP/SFTP**, **FTPS**
  (explicit or implicit) and **FTP**, encrypted before they leave the server,
  scheduled with retention, and restore from any backup, also onto a new server.
  See [docs/backup.md](docs/backup.md).
- **Info button** with the version, commit and channel, **check for updates**,
  **update from the UI**, and a switch between the **production** and **test**
  channel. See [docs/updates.md](docs/updates.md).

## Install (Proxmox LXC or any Debian 13 server)

Native install, no Docker. On a clean Debian 13 container (2 vCPU, 2 GB RAM, 8 GB disk is plenty for now):

```sh
curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash
```

While the repository is private, download the script with a token and pass the same
token so the server can update itself:

```sh
curl -fsSL -H "Authorization: Bearer <token>" \
  https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash -s -- --token <token>
```

Options: `--channel test`, `--port 8080`. Full guide: [docs/install.md](docs/install.md).

## Branches

| Branch | Channel | Use |
| --- | --- | --- |
| `production` | Production | Stable. Servers on the production channel install from here. |
| `test` | Test | Preview of the next release. Every change lands here first. |

Work happens on feature branches with a pull request into `test`. When `test` is
good, it is merged into `production`. Bump `version` in `package.json` for a release.

## Development

```sh
npm install
# PostgreSQL with a database the user can own:
export DATABASE_URL=postgres://netsim:netsim@127.0.0.1/network_simulator
export NETSIM_DATA_DIR=$PWD/server/data
npm run build -w server && node server/dist/cli.js create-admin admin
npm run dev            # API on :8080, web interface on :5173
```

Checks: `npm run typecheck`, `npm test`, `npm run check-i18n` (English and Dutch
must have the same keys), `npm run build`.

## Stack

TypeScript everywhere. Backend: Node.js 24, Fastify, PostgreSQL (`postgres`),
nodemailer, basic-ftp, ssh2, Argon2id passwords. Frontend: React 19, Vite,
Tailwind CSS 4, react-i18next, lucide icons. Deployment: systemd, with separate
root helpers for updates and restores so the web server never runs as root.
