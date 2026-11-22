# Installation

[Nederlands](install.nl.md)

Network Simulator runs natively on Debian 13 (trixie), without Docker. A
Proxmox LXC container is the intended home.

## 1. Create the container (Proxmox)

- Template: `debian-13-standard`
- 2 vCPU, 2048 MB RAM, 8 GB disk (more later, when the simulator grows)
- Unprivileged is fine. Network: a static IP or a DHCP reservation.

## 2. Run the installer

As root in the container:

```sh
curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash
```

While the repository is private, create a **fine-grained personal access token**
on GitHub with read-only access to *Contents* of `network-simulator`, and use it twice:

```sh
TOKEN=github_pat_...
curl -fsSL -H "Authorization: Bearer $TOKEN" \
  https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash -s -- --token "$TOKEN"
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--channel production\|test` | `production` | Which branch to install |
| `--port <n>` | `8080` | HTTP port |
| `--token <token>` | none | GitHub token for a private repository (stored in `/etc/network-simulator/server.env`) |

The installer:

1. installs PostgreSQL, git, jq and Node.js 24 LTS (NodeSource),
2. creates the system user `netsim` and the database `network_simulator`
   (peer authentication over the local socket, no password),
3. clones the repository to `/opt/network-simulator/repo` and builds a release
   in `/opt/network-simulator/releases/<commit>`, linked as `current`,
4. installs the systemd units and the helpers `network-simulator-update` and
   `network-simulator-restore`,
5. creates the `admin` account and prints its **one-time password**.

Open `http://<container-ip>:8080`, sign in as `admin` and choose your own password.

## 3. Reverse proxy (recommended)

Put the server behind your reverse proxy (Zoraxy, nginx, Caddy, Traefik) with
TLS. Forward to `http://<container-ip>:8080` and pass `X-Forwarded-Proto`, so
session cookies are marked `Secure`. Without a proxy, set
`NETSIM_TRUST_PROXY=false` in `/etc/network-simulator/server.env`.

## Files and services

| Path | Content |
| --- | --- |
| `/etc/network-simulator/server.env` | Settings (port, database, update repository and token) |
| `/var/lib/network-simulator` | Data: `secret.key` (encrypts stored passwords), restore staging |
| `/var/lib/network-simulator-update` | Updater status and database dumps made before updates |
| `/opt/network-simulator/current` | The running release |

| Unit | Role |
| --- | --- |
| `network-simulator.service` | The web server, as user `netsim`, hardened |
| `network-simulator-update.path/.service` | Installs an update requested in the web interface (root) |
| `network-simulator-restore.path/.service` | Applies a restore verified in the web interface (root) |

Useful commands:

```sh
systemctl status network-simulator
journalctl -u network-simulator -f
journalctl -u network-simulator-update
sudo network-simulator reset-admin     # new one-time password for admin
sudo network-simulator version
```

Running the installer again repairs an installation and keeps all data.
