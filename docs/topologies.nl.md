# Topologieën en de simulator

[English](topologies.md)

## Een netwerk bouwen

1. Open **Topologieën** en kies **Nieuwe topologie**. Kies een startlab of een leeg canvas.
2. Sleep apparaten van de strook links naar het canvas (of klik erop om ze toe te voegen).
3. Kies **Kabel** (of druk op `C`), klik op het eerste apparaat en kies een poort, klik
   daarna op het tweede apparaat en kies een poort. Kabels tussen twee switches worden
   trunks.
4. Klik op een apparaat om het rechts te configureren: IP-adressen en gateway, poorten
   (access/trunk, VLAN, shutdown), VLAN's, statische routes, ACL's, spanning tree.
5. Wijzigingen worden automatisch opgeslagen. `Ctrl+Z` / `Ctrl+Y` maken ongedaan en
   opnieuw, `Delete` verwijdert de selectie, het muiswiel zoomt en slepen over de
   achtergrond verschuift het beeld.

Adressen typ je als `192.168.1.10/24` of `192.168.1.10 255.255.255.0`.

## Testen

Kies onderaan **Ping**, **Traceroute** of **TCP-verbinding**, een bronapparaat en een
doeladres en druk op **Versturen**. Elk frame gaat als bolletje over de kabels:

| Kleur | Betekenis |
| --- | --- |
| Lichtblauw | ARP |
| Koraal | Echo-verzoek (ping) |
| Groen | Echo-antwoord |
| Oranje | ICMP-fout (onbereikbaar, TTL verlopen) |
| Paars | TCP |

Een klein getal boven een bolletje is de 802.1Q-VLAN-tag op een trunk. Een rood kruis
markeert de poort waar een pakket is weggegooid; het tabblad **Resultaat** legt uit waar
en waarom, en het **Pakketlog** toont elk frame. Een grijs kruis is een poort die door
spanning tree geblokkeerd wordt (normaal op een redundante verbinding). Aan het eind
krijgt het bronapparaat een groen vinkje of een rood kruis.

Het tabblad **Tabellen** van een apparaat toont de interfaces, routeringstabel,
ARP-tabel, MAC-adrestabel en spanning-tree-rollen. **Tabellen wissen** maakt de ARP- en
MAC-tabellen leeg, zodat je ze opnieuw kunt zien vullen.

De **configuratiecontrole** rechtsboven toont fouten die zonder pakket al te vinden
zijn, zoals dubbele IP-adressen, een gateway buiten het subnet, verschillende native
VLAN's of een access-poort in een VLAN die niet bestaat.

## Wat de engine simuleert

- Ethernet-switching met MAC-learning, flooding en filtering per VLAN.
- Access- en trunkpoorten, 802.1Q-tags, native VLAN, lijsten met toegestane VLAN's.
- Spanning tree (één boom voor alle VLAN's): root bridge op prioriteit en MAC, root- en
  designated-poorten, alternate-poorten geblokkeerd. Een lus zonder spanning tree geeft
  een broadcaststorm; de simulator herkent en stopt die.
- IPv4 met ARP, gerouteerde poorten, subinterfaces (router-on-a-stick),
  VLAN-interfaces (SVI) op een multilayer-switch, loopbacks, `ip routing` aan of uit.
- Statische routes (ook recursief), standaardgateways op hosts en switches.
- Extended ACL's (permit/deny, IP/ICMP/TCP/UDP, wildcards, poorten) inkomend en
  uitgaand; een geweigerd pakket krijgt "administratively prohibited" terug.
- ICMP-echo, time exceeded en unreachable; TCP-verbindingen krijgen SYN-ACK (open poort
  op een server) of RST (dichte poort).

OSPF, BGP, de Cisco-achtige commandoregel, Windows-clients en servers volgen in fase 3;
lessen en troubleshootingopdrachten in fase 4.

## Bestanden

**Exporteren** (rechtsboven in de editor) downloadt de topologie als
`.netsim.json`-bestand. **Importeren** op de pagina Topologieën maakt een nieuwe
topologie van zo'n bestand. Topologieën staan in de database en zitten in elke back-up.
