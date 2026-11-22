# Apparaatconsole

Elke router en switch heeft een IOS-achtige opdrachtregel, vanaf nul geschreven in de
engine (`engine/src/cli/`). Er wordt geen echte Cisco-software gebruikt.

## Openen

Open een topologie en dubbelklik op een router of switch, of selecteer hem en klik op
het terminalpictogram in het zijpaneel. Elk apparaat krijgt een eigen tabblad in het
consolevenster. Configuratiecommando's passen de topologie direct aan: ze worden
automatisch opgeslagen en elk commando is één stap voor ongedaan maken in de editor.
`ping` en `traceroute` worden op het canvas geanimeerd.

## Toetsen

| Toets | Werking |
| --- | --- |
| `?` | Toont wat er kan volgen (`show ?`, `sh?`) |
| Tab | Vult het sleutelwoord aan |
| Pijl omhoog / omlaag, Ctrl+P / Ctrl+N | Commandogeschiedenis |
| Ctrl+Z, Ctrl+C | Terug naar privileged EXEC |
| Ctrl+L | Scherm leegmaken |

Sleutelwoorden mogen worden afgekort tot elk uniek begin (`sh ip int br`). Foutmeldingen
volgen de IOS-tekst, met een `^` onder het foute woord.

## Modi en commando's

- **User EXEC** (`R1>`): `enable`, `show …`, `ping`, `traceroute`.
- **Privileged EXEC** (`R1#`): `configure terminal`, `show running-config`,
  `copy running-config startup-config`, `write`, `clear arp-cache`,
  `clear mac address-table dynamic`.
- **Globale configuratie** (`(config)#`): `hostname`, `interface`, `interface range`,
  `vlan`, `ip routing`, `ip default-gateway`, `ip route` (next hop, uitgaande
  interface, afstand), `ip access-list standard|extended`, `access-list 1-199`,
  `spanning-tree vlan … priority`. `do <commando>` voert een EXEC-commando uit; `no`
  draait iets terug.
- **Interface** (`(config-if)#`): `ip address`, `shutdown`, `description`,
  `switchport mode access|trunk`, `switchport access vlan`,
  `switchport trunk native vlan`, `switchport trunk allowed vlan [add|remove]`,
  `no switchport` (multilayer switches), `encapsulation dot1Q` (subinterfaces),
  `ip access-group … in|out`, `spanning-tree cost`.
  `interface vlan 10`, `interface loopback 0` en `interface g0/0.10` maken de
  interface aan als die nog niet bestaat.
- **VLAN** (`(config-vlan)#`): `name`.
- **Access list** (`(config-ext-nacl)#`, `(config-std-nacl)#`): `permit`, `deny`,
  volgnummers, `no <volgnummer>`, `remark`.

Show-commando's: `show running-config`, `show ip interface brief`, `show interfaces`,
`show interfaces trunk`, `show ip route`, `show arp`, `show mac address-table`,
`show vlan brief`, `show spanning-tree`, `show access-lists`, `show cdp neighbors`,
`show version`, `show module` (linecards van het chassis), `show history`.

Commando's zonder effect in de simulator (wachtwoorden, banners, `line vty`, `speed`,
`duplex`) worden geaccepteerd, zodat configuraties uit echte labs geplakt kunnen worden.

## Uitbreiden

Routeringsprotocollen voegen modi en commando's toe met `registerCliExtension` in
`engine/src/cli/ios.ts`, naast `registerRoutingProtocol`.
