# Updates en kanalen

[English](updates.md)

## Kanalen

| Kanaal | Branch | Voor |
| --- | --- | --- |
| Productie | `production` | Normaal gebruik |
| Test | `test` | De volgende versie uitproberen voordat hij in productie komt |

De knop **Info** (bovenbalk) toont de geïnstalleerde versie, commit, bouwdatum
en het kanaal. Beheerders kunnen daar op updates controleren, of via
**Beheer > Updates**.

## Updaten vanuit de webinterface

1. Kies een kanaal en druk op **Controleren op updates**. De server vraagt GitHub
   naar de nieuwste commit op die branch en de bijbehorende versie.
2. Druk op **Nu updaten** (of **Overstappen naar Test/Productie** voor een ander
   kanaal) en bevestig.
3. De webserver schrijft een klein verzoekbestand met alleen de branch en de
   commit-id. De systemd path-unit start `network-simulator-update` als root, die:
   - beide branches ophaalt en controleert dat de commit op de gekozen branch staat,
   - de nieuwe release naast de draaiende bouwt (de site blijft bereikbaar),
   - een databasedump maakt in `/var/lib/network-simulator-update/backups`,
   - de server stopt, de migraties uitvoert, `current` omzet en weer start,
   - wacht tot `/healthz` de nieuwe commit meldt.
4. Komt de nieuwe versie niet op, dan worden de vorige release en de databasedump
   automatisch teruggezet. De status toont dan *Teruggezet*.

De pagina laadt vanzelf opnieuw als de update klaar is.

## Van test terug naar productie

Productie kan ouder zijn dan test. Databasemigraties gaan alleen vooruit, dus
gegevenswijzigingen van de testversie blijven. Start productie niet op die
database, dan zet de updater de dump terug die hij vlak voor de overstap maakte.

## Privérepository

De updatecontrole gebruikt de GitHub-API en de updater gebruikt git. Bij een
privérepository hebben beide `NETSIM_UPDATE_TOKEN` nodig in
`/etc/network-simulator/server.env` (fine-grained token, alleen lezen op
*Contents*). Herstart de service na een wijziging.

## Een release maken (voor ontwikkelaars)

1. Featurebranch, pull request naar `test`. Servers op het testkanaal kunnen hem
   direct na de merge installeren.
2. Is `test` goed: verhoog `version` in `package.json` en merge `test` naar `production`.
