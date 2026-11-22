# Network Simulator

**Een webgebaseerd platform om netwerken te simuleren en te leren.** Bouw
netwerken met virtuele Cisco-achtige routers en switches, configureer ze via de
opdrachtregel en zie het verkeer als bewegende pakketjes, zodat je in één
oogopslag ziet wat werkt en wat niet.

[English](README.md)

> **Status:** fase 1 van 4, het fundament. De simulator zelf volgt in de
> volgende fasen (zie de roadmap).

## Roadmap

| Fase | Wat | Status |
| --- | --- | --- |
| 1 | Fundament: gebruikers, mailserver, versleutelde back-ups, updates vanuit de interface, Engels en Nederlands | Klaar |
| 2 | Simulatie-engine, visuele topologie-editor, geanimeerde verkeersstromen | Gepland |
| 3 | Cisco-achtige CLI voor routers en switches, vanaf nul gebouwd (ook Catalyst 6500-stijl): VLAN's, trunks, statische routes, OSPF, BGP, ACL's, later IPsec. Windows-werkstations en web-/bestandsservers | Gepland |
| 4 | Lessen en troubleshootingopdrachten met automatische controle | Gepland |

Er worden geen echte Cisco-images gebruikt: elk apparaat wordt door de eigen engine van het platform gesimuleerd.

## Wat zit er in fase 1

- **Moderne webinterface** in de RHIS-huisstijl (zie [`brand/`](brand)), menu
  links, licht en donker thema, werkt op een telefoon.
- **Engels en Nederlands**, per gebruiker en te wisselen in de bovenbalk.
- **Gebruikers en rollen**: beheerder, docent, student. Eenmalige wachtwoorden,
  verplicht wachtwoord wijzigen, auditlog.
- **Mailserver**: je eigen SMTP-server met STARTTLS (verplicht) of impliciete TLS,
  minimaal TLS 1.2/1.3, certificaatcontrole, LOGIN/PLAIN/CRAM-MD5, optioneel
  DKIM-ondertekening en een testknop. Wordt gebruikt voor meldingen zoals een
  mislukte back-up.
- **Back-up en herstel**: volledige en incrementele back-ups naar **SCP/SFTP**,
  **FTPS** (expliciet of impliciet) en **FTP**, versleuteld voordat ze de server
  verlaten, gepland met bewaartermijn, en terugzetten vanaf elke back-up, ook op
  een nieuwe server. Zie [docs/backup.nl.md](docs/backup.nl.md).
- **Info-knop** met versie, commit en kanaal, **controleren op updates**,
  **updaten vanuit de interface**, en wisselen tussen het **productie**- en
  **test**kanaal. Zie [docs/updates.nl.md](docs/updates.nl.md).

## Installeren (Proxmox LXC of elke Debian 13-server)

Native installatie, geen Docker. Op een schone Debian 13-container (2 vCPU, 2 GB RAM, 8 GB schijf is voorlopig ruim genoeg):

```sh
curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash
```

Zolang de repository privé is, download je het script met een token en geef je
hetzelfde token mee, zodat de server zichzelf kan updaten:

```sh
curl -fsSL -H "Authorization: Bearer <token>" \
  https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | bash -s -- --token <token>
```

Opties: `--channel test`, `--port 8080`. Volledige handleiding: [docs/install.nl.md](docs/install.nl.md).

## Branches

| Branch | Kanaal | Gebruik |
| --- | --- | --- |
| `production` | Productie | Stabiel. Servers op het productiekanaal installeren hiervandaan. |
| `test` | Test | Voorproefje van de volgende versie. Elke wijziging komt hier eerst. |

Werk gebeurt op featurebranches met een pull request naar `test`. Is `test` goed,
dan gaat hij naar `production`. Verhoog `version` in `package.json` voor een release.

## Ontwikkelen

Zie de Engelse [README](README.md#development).
