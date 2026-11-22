# Back-up en herstel

[English](backup.md)

Alles staat onder **Beheer > Back-up & herstel** (alleen beheerders).

## Wat zit er in een back-up

- De PostgreSQL-database (gebruikers, instellingen, back-uplocaties, geschiedenis,
  auditlog; in latere fasen topologieën en lessen). Actieve sessies niet.
- De datamap `/var/lib/network-simulator`, met `secret.key`, die de opgeslagen
  wachtwoorden versleutelt (SMTP, back-uplocaties).

## Hoe het werkt

- **Volledig en incrementeel.** Een volledige back-up begint een nieuwe *keten*.
  Incrementele back-ups knippen de gegevens in blokken op basis van de inhoud en
  uploaden alleen blokken die de keten nog niet heeft. Elke back-up noemt al zijn
  blokken, dus elke back-up is los terug te zetten; je hoeft nooit zelf een keten
  toe te passen.
- **Versleuteld voordat het de server verlaat.** Elk blok wordt gecomprimeerd
  (zstd) en versleuteld met AES-256-GCM. De datasleutel is ingepakt met een
  sleutel die uit je wachtwoordzin wordt afgeleid (scrypt). Bloknamen zijn
  gesleutelde hashes, dus de opslagserver weet niets van de inhoud.
- **Gecontroleerd bij terugzetten.** Elk blok wordt geauthenticeerd en elk
  bestand tegen zijn SHA-256 gecontroleerd voordat er iets verandert.
- **Bewaartermijn.** Elke *N* dagen een nieuwe volledige back-up; de nieuwste *K*
  ketens blijven, oudere worden met hun incrementele back-ups verwijderd.

Indeling op de locatie: `netsim-backup.json` (ingepakte sleutel),
`chains/<id>/chunks/`, `chains/<id>/manifests/`.

## 1. Wachtwoordzin instellen

Tabblad **Planning & versleuteling**. Minstens 12 tekens. **Bewaar hem in je
wachtwoordmanager**: zonder kan niemand de back-ups terugzetten. Wijzig je hem
later, dan wordt de sleutel op elke bereikbare locatie opnieuw ingepakt;
bestaande back-ups blijven leesbaar.

## 2. Locaties toevoegen

| Type | Voor | Opmerkingen |
| --- | --- | --- |
| SCP / SFTP | NAS (Synology, QNAP), Linux-server | Wachtwoord of SSH-sleutel (OpenSSH/PEM). Gebruikt het SSH-bestandsoverdrachtsubsysteem dat elke SCP-server biedt. Alleen moderne algoritmen (curve25519, AES-GCM, ChaCha20). |
| FTPS | FTP-server met TLS | Expliciete TLS op 21 of impliciete TLS op 990, TLS 1.2 of nieuwer. |
| FTP | Alleen oude servers | Het wachtwoord gaat onversleuteld; de back-up zelf is wel versleuteld. |

Druk op **Verbinding testen**: de server maakt verbinding, schrijft, leest en
verwijdert een testbestand en zoekt naar bestaande back-ups. De eerste keer toont
hij de **SSH-hostsleutel** of, bij een zelfondertekend FTPS-certificaat, de
**vingerafdruk van het certificaat**. Vergelijk die met de server en druk op
**Vertrouwen**. Verandert de sleutel later, dan stoppen de back-ups tot je hem
opnieuw vertrouwt.

Synology-voorbeeld: Configuratiescherm > Bestandsservices > FTP > *SFTP*
inschakelen, gebruiker `netsim-backup` maken met toegang tot één gedeelde map,
daarna een locatie van het type SCP / SFTP met poort 22 en map
`backup/network-simulator`.

## 3. Planning

Kies hoe vaak (elk uur tot dagelijks), vanaf hoe laat, hoe vaak een nieuwe
volledige back-up begint en hoeveel volledige back-ups je bewaart. Een back-up
die gemist is omdat de server uit stond, loopt zodra hij weer aan staat. Mislukt
een back-up, dan krijgt elke beheerder met een e-mailadres een bericht (stel
eerst de mailserver in).

**Nu back-up maken** maakt een incrementele back-up (of een volledige als de
locatie er nog geen heeft); **Volledige back-up** begint een nieuwe keten.

## Terugzetten op dezelfde server

1. Tabblad **Terugzetten**, kies de locatie en druk op **Back-ups zoeken**.
2. Kies een back-up, druk op **Deze back-up terugzetten** en typ `RESTORE`.
3. De server downloadt en controleert de back-up in een tijdelijke map. Daarna
   stopt het hulpprogramma `network-simulator-restore` de server, vervangt de
   database (in één transactie) en de datamap, voert migraties uit en start weer.
4. Iedereen wordt afgemeld. Meld je aan met een account uit de back-up.

De vorige toestand blijft in `/var/lib/network-simulator/restore/rollback` tot de
volgende keer terugzetten en wordt automatisch teruggezet als het mislukt. Een
back-up van een nieuwere versie kan niet op een oudere worden teruggezet: update eerst.

## Terugzetten op een nieuwe server

1. Installeer Network Simulator op een nieuwe container (zie
   [install.nl.md](install.nl.md)) en meld je aan met het eenmalige wachtwoord.
2. **Back-up & herstel > Terugzetten**, kies **Andere locatie**, vul de locatie van
   de oude server en de wachtwoordzin in, druk op **Back-ups zoeken**.
3. Zet de nieuwste back-up terug. Meld je na de herstart aan met je oude account.
   Locaties, wachtwoordzin en planning komen met de back-up mee.
