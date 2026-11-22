# Lessen en troubleshooting

**Lessen & labs** in het menu toont troubleshooting-scenario's. Elk scenario is een netwerk
met één of meer fouten erin, een opdracht, hints en doelen. De simulator controleert de
doelen automatisch.

## Voor studenten

1. Open een scenario en kies **Beginnen**. Je krijgt een eigen kopie van het netwerk; die
   staat ook onder Topologieën.
2. Boven het canvas toont de lesbalk de opdracht en de doelen. Herstel het netwerk zoals
   altijd met de console, het zijpaneel en de simulatie.
3. **Controleer mijn werk** slaat de topologie op en controleert elk doel. Een doel dat
   niet gehaald wordt, zegt waarom (bijvoorbeeld "Geen antwoord van 10.2.0.10").
4. **Hint** opent de volgende hint. Je docent ziet hoeveel hints je gebruikte.
5. **Opnieuw beginnen** zet het oorspronkelijke netwerk terug. Gebruikte hints blijven
   meetellen.

De doelen beschrijven het werkende netwerk, niet de oplossing: elke oplossing die ze haalt,
telt. Zodra alle doelen slagen, is het scenario afgerond; dat blijft zo als je daarna verder
experimenteert.

## Ingebouwde scenario's

| Scenario | Niveau | Onderwerp |
| --- | --- | --- |
| PC2 bereikt zijn buren niet | Basis | IP-adressen |
| De server is onbereikbaar | Basis | Default gateway |
| De ping gaat weg, er komt niets terug | Gevorderd | Statische routes |
| Gasten hebben geen netwerk | Gevorderd | VLAN's en trunks |
| OSPF-buren ontbreken | Gevorderd | OSPF |
| Kantoor-pc's krijgen 169.254-adressen | Gevorderd | DHCP-relay |
| Het intranet is geblokkeerd | Expert | Toegangslijsten |
| De BGP-sessie blijft down | Expert | BGP |
| De VPN tussen de locaties ligt eruit | Expert | IPsec |

## Voor docenten (rol instructor of admin)

**Een scenario schrijven.** Bouw het netwerk met de fouten erin als gewone topologie. Kies
daarna **Nieuw scenario**: geef een titel, een opdracht (de situatie en wat moet werken, niet
de fout), een niveau, hints en de starttopologie. Bij opslaan wordt er een kopie gemaakt.

**Doelen.** Een doel is een van:

| Doel | Slaagt als |
| --- | --- |
| Ping | een apparaat wel (of geen) antwoord krijgt van een adres of apparaat |
| TCP-verbinding | een poort op een server open is, of onderweg geblokkeerd wordt |
| Route aanwezig | een apparaat een route naar een netwerk heeft |
| OSPF-buren | twee routers een volledige adjacency hebben |
| BGP-sessie | een BGP-sessie naar een peer is opgebouwd |
| IPsec-tunnel actief | alle tunnels van een router actief zijn |
| DHCP-lease | een host een adres via DHCP kreeg |
| Geen diagnosefouten | de diagnose geen fouten toont |

Apparaten worden op naam gezocht. **Doelen testen** controleert ze op een van je
topologieën: op de starttopologie horen ze te falen, op een herstelde kopie te slagen.

**Publiceren en toewijzen.** Een gepubliceerd scenario is zichtbaar voor alle studenten. Een
niet-gepubliceerd scenario alleen voor de studenten aan wie je het toewijst. **Toewijzen**
geeft een scenario (ingebouwd of eigen) aan alle of aan gekozen studenten, met een
inleverdatum en notitie als je wilt. Toegewezen scenario's staan voor de student bovenaan.

**Voortgang.** Lessen & labs → **Voortgang** toont per student en scenario of het niet
begonnen, deels gedaan (gehaalde doelen) of afgerond is, met het aantal gebruikte hints.
Klik op een resultaat voor details en om het netwerk van de student naar je eigen
topologieën te kopiëren.
