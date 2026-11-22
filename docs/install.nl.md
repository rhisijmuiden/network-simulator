# Installatie

[English](install.md)

Network Simulator draait native op Debian 13 (trixie), zonder Docker. Een
Proxmox LXC-container is de bedoelde plek.

## 1. Container aanmaken (Proxmox)

- Template: `debian-13-standard`
- 2 vCPU, 2048 MB RAM, 8 GB schijf (later meer, als de simulator groeit)
- Unprivileged is prima. Netwerk: een vast IP of een DHCP-reservering.

## 2. Installer uitvoeren

Als root in de container:

```sh
curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash
```

Zolang de repository privé is, maak je op GitHub een **fine-grained personal
access token** met alleen leesrechten op *Contents* van `network-simulator`, en
gebruik je het twee keer:

```sh
TOKEN=github_pat_...
curl -fsSL -H "Authorization: Bearer $TOKEN" \
  https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash -s -- --token "$TOKEN"
```

| Optie | Standaard | Betekenis |
| --- | --- | --- |
| `--channel production\|test` | `production` | Welke branch je installeert |
| `--port <n>` | `8080` | HTTP-poort |
| `--token <token>` | geen | GitHub-token voor een privérepository (komt in `/etc/network-simulator/server.env`) |

De installer:

1. installeert PostgreSQL, git, jq en Node.js 24 LTS (NodeSource),
2. maakt de systeemgebruiker `netsim` en de database `network_simulator`
   (peer-authenticatie via de lokale socket, geen wachtwoord),
3. kloont de repository naar `/opt/network-simulator/repo` en bouwt een release
   in `/opt/network-simulator/releases/<commit>`, gekoppeld als `current`,
4. installeert de systemd-units en de hulpprogramma's `network-simulator-update`
   en `network-simulator-restore`,
5. maakt het account `admin` en toont het **eenmalige wachtwoord**.

Open `http://<container-ip>:8080`, meld je aan als `admin` en kies je eigen wachtwoord.

## 3. Reverse proxy (aanbevolen)

Zet de server achter je reverse proxy (Zoraxy, nginx, Caddy, Traefik) met TLS.
Stuur door naar `http://<container-ip>:8080` en geef `X-Forwarded-Proto` mee,
zodat sessiecookies als `Secure` worden gemarkeerd. Zonder proxy zet je
`NETSIM_TRUST_PROXY=false` in `/etc/network-simulator/server.env`.

## Bestanden en services

| Pad | Inhoud |
| --- | --- |
| `/etc/network-simulator/server.env` | Instellingen (poort, database, update-repository en token) |
| `/var/lib/network-simulator` | Gegevens: `secret.key` (versleutelt opgeslagen wachtwoorden), restore-staging |
| `/var/lib/network-simulator-update` | Status van de updater en databasedumps van vóór updates |
| `/opt/network-simulator/current` | De draaiende release |

| Unit | Rol |
| --- | --- |
| `network-simulator.service` | De webserver, als gebruiker `netsim`, afgeschermd |
| `network-simulator-update.path/.service` | Installeert een update die in de webinterface is aangevraagd (root) |
| `network-simulator-restore.path/.service` | Past een in de webinterface gecontroleerde back-up toe (root) |

Handige opdrachten:

```sh
systemctl status network-simulator
journalctl -u network-simulator -f
journalctl -u network-simulator-update
sudo network-simulator reset-admin     # nieuw eenmalig wachtwoord voor admin
sudo network-simulator version
```

De installer opnieuw uitvoeren repareert een installatie en houdt alle gegevens.
