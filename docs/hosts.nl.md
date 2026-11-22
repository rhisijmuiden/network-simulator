# Pc's en servers

## Netwerkinstellingen

In het zijpaneel (tabblad Algemeen) krijgt een pc of server een vast adres en gateway, of
**Automatisch een adres krijgen (DHCP)**. Met DHCP toont het paneel het uitgedeelde adres,
of waarom er geen is (geen DHCP-server antwoordt, geen pool voor het netwerk, pool vol).
De DNS-server stel je zelf in; met DHCP komt hij uit de pool.

## Opdrachtprompt

Dubbelklik op een pc of server voor een opdrachtprompt in Windows-stijl:

| Commando | Wat het doet |
| --- | --- |
| `ipconfig`, `ipconfig /all` | Adres, masker, gateway, DHCP-server en DNS-servers. Zonder antwoord van DHCP toont Windows een 169.254.x.x-adres. |
| `ipconfig /renew`, `/release` | Toont de lease (de simulator heeft altijd de geconvergeerde toestand). |
| `ping [-n aantal] <host>` | Echo-verzoeken, geanimeerd op het canvas. Namen worden eerst in DNS opgezocht. |
| `tracert <host>` | Route naar een host. |
| `arp -a` | ARP-cache. |
| `nslookup <naam> [server]` | DNS-opvraging. |
| `netsh interface ip set address "Ethernet0" static <ip> <masker> [gateway]` / `dhcp` | Adres wijzigen. |
| `netsh interface ip set dns "Ethernet0" static <server>` / `dhcp` | DNS-server wijzigen. |
| `curl http://<host>/` | Pagina van een webserver ophalen. |
| `net view \\<server>`, `dir \\<server>\<share>` | Shares en bestanden van een bestandsserver tonen. |
| `ftp <host>`, `telnet <host> <poort>` | FTP of een willekeurige TCP-poort testen. |
| `hostname`, `cls`, `help` | |

## Serverdiensten (tabblad Diensten)

- **Webserver**: poort 80 en 443, met een paginatitel en inhoud (`curl`).
- **DNS-server**: UDP 53, met naamrecords.
- **DHCP-server**: UDP 67, met pools (netwerk, eerste en laatste adres, gateway,
  DNS-server). Een client in het netwerk van de server krijgt een adres uit de pool van dat
  netwerk. Clients elders hebben een routerinterface met `ip helper-address <server>` in
  hun netwerk nodig; de pool wordt gekozen op het netwerk van die routerinterface.
- **Bestanden delen**: SMB (445) en FTP (21), met shares en bestandsnamen.
- **Andere open poorten**: extra TCP-poorten.

Access lists gelden voor dit alles: een `deny udp any any eq domain` op de route laat
`nslookup` verlopen. De configuratiecheck waarschuwt voor pc's die geen DHCP-adres
krijgen. Het startlab "Kantoor met diensten" heeft dit allemaal ingesteld.
