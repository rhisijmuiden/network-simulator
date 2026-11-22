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

## OSPF en BGP

Beide draaien in hun geconvergeerde toestand: zodra de configuratie compleet is, zijn
de routeringstabellen zoals ze na het uitwisselen van de protocollen zouden zijn.

**OSPF** (`router ospf <proces-id>`)

- `network <adres> <wildcard> area <id>` zet OSPF aan op de interfaces die erbij
  passen; `router-id`, `passive-interface <interface>`, `default-information originate`
  (vraagt een statische standaardroute op die router).
- Interface: `ip ospf cost <1-65535>`. De standaardkosten gaan uit van 100 Mb/s.
- Buren ontstaan over een gedeeld segment (ook via switches en VLAN's) als gebied,
  subnet en masker gelijk zijn, geen van beide kanten passief is en de router-ID's
  verschillen. Loopbacks worden als /32 aangekondigd.
- Routes: `O`, `O IA` (ander gebied) en `O*E2` (standaardroute).
- Show: `show ip ospf neighbor`, `show ip ospf interface brief`, `show ip ospf` (toont
  ook routers op het segment die geen buur worden, en waarom), `show ip protocols`,
  `show ip route ospf`.

**BGP** (`router bgp <as>`)

- `neighbor <adres> remote-as <as>`, `neighbor <adres> next-hop-self`,
  `network <adres> mask <masker>` (het netwerk moet met precies dat masker in de
  routeringstabel staan), `bgp router-id`.
- Een sessie komt op als beide kanten naar elkaar wijzen met de juiste AS-nummers en
  elkaar kunnen bereiken; eBGP-buren moeten direct verbonden zijn.
- Paden volgen de gebruikelijke regels: controle op lussen in het AS-pad, geen
  doorgeven van iBGP naar iBGP, next hop ongewijzigd naar iBGP-buren tenzij
  `next-hop-self`, beste pad op kortste AS-pad en daarna eBGP boven iBGP.
  eBGP-routes hebben afstand 20, iBGP 200.
- Show: `show ip bgp summary`, `show ip bgp`, `show ip route bgp`.

Het zijpaneel (tabblad Routes) toont de OSPF-buren en BGP-sessies van een apparaat, met
de reden als er een niet opkomt. De startlabs "OSPF-driehoek" en "Twee netwerken met
BGP" staan klaar om mee te experimenteren.

## Uitbreiden

Routeringsprotocollen voegen modi en commando's toe met `registerCliExtension` in
`engine/src/cli/ios.ts`, naast `registerRoutingProtocol`.
