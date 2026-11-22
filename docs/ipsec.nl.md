# Site-to-site-IPsec

Routers kunnen een site-to-site-VPN opzetten met IKEv1 en crypto maps. Je stelt dat in
via de console, net als op een Cisco IOS-router. Begin met het sjabloon
**Site-to-site-VPN**: twee locaties, een internetrouter (ISP) die alleen de publieke
adressen kent, en een werkende tunnel tussen R1 en R2.

## Configuratie

```
crypto isakmp policy 10
 encryption aes 256
 hash sha256
 authentication pre-share
 group 14
crypto isakmp key Lab-Secret1 address 198.51.100.2
!
crypto ipsec transform-set TS esp-aes 256 esp-sha-hmac
 mode tunnel
!
access-list 110 permit ip 10.1.0.0 0.0.0.255 10.2.0.0 0.0.0.255
!
crypto map VPN 10 ipsec-isakmp
 set peer 198.51.100.2
 set transform-set TS
 match address 110
!
interface GigabitEthernet0/1
 crypto map VPN
```

De andere router krijgt dezelfde configuratie met de adressen omgedraaid: een eigen key
voor de eerste router, `set peer` die terugwijst, en de crypto-ACL gespiegeld
(`permit ip 10.2.0.0 0.0.0.255 10.1.0.0 0.0.0.255`).

| Commando | Modus |
| --- | --- |
| `crypto isakmp policy <n>`: `encryption des\|3des\|aes [128\|192\|256]`, `hash md5\|sha\|sha256\|sha384\|sha512`, `authentication pre-share\|rsa-sig`, `group <n>`, `lifetime <s>` | globaal, daarna `(config-isakmp)` |
| `crypto isakmp key <key> address <peer> [masker]` | globaal |
| `crypto ipsec transform-set <naam> <transforms>`, `mode tunnel\|transport` | globaal, daarna `(cfg-crypto-trans)` |
| `crypto map <naam> <volgnr> ipsec-isakmp`: `set peer`, `set transform-set`, `match address`, `set pfs group<n>` | globaal, daarna `(config-crypto-map)` |
| `crypto map <naam>` | interface |
| `show crypto isakmp sa`, `show crypto isakmp policy`, `show crypto ipsec sa`, `show crypto ipsec transform-set`, `show crypto map`, `show crypto session` | privileged |
| `ping <ip> source <interface>` | privileged: test de tunnel vanaf de router zelf, vanaf zijn LAN-adres |
| `clear crypto sa` | privileged: zet de pakkettellers op nul |

Een nieuwe ISAKMP-policy krijgt de standaardwaarden van IOS (des, sha, rsa-sig, groep 1,
86400 seconden). De simulator heeft geen certificaten, dus gebruik `authentication pre-share`.

## Hoe de simulator ermee omgaat

- De tunnel wordt berekend in de geconvergeerde toestand, net als bij de
  routeringsprotocollen: hij is actief als beide kanten het eens zijn en elkaar kunnen
  bereiken. Er is geen IKE-verkeer om te bekijken.
- Een pakket dat een interface met een crypto map verlaat en een `permit` in de
  crypto-ACL raakt, wordt in ESP verpakt en naar de peer gestuurd. Op het canvas zijn
  ESP-pakketten goudkleurig; de internetrouter ertussen ziet alleen de publieke adressen.
- De peer pakt het pakket uit en routeert het origineel verder. Onversleutelde pakketten
  die door de tunnel hadden moeten komen, worden weggegooid.
- Traceroute toont de routers in de tunnel niet. De VPN-router aan de overkant antwoordt
  vanaf zijn buitenadres, dat niet in de crypto-ACL valt, dus die hop toont `*`, net als
  op echte apparatuur.
- Een inkomende toegangslijst op de buiteninterface moet IKE (`udp eq isakmp`) en `esp`
  van de peer doorlaten.

## Waarom een tunnel niet opkomt

Het diagnosepaneel, het tabblad Routes in het zijpaneel en `show crypto session` noemen
de reden:

| Reden | Wat je controleert |
| --- | --- |
| Onvolledig | De crypto map heeft `set peer`, `set transform-set` en `match address` nodig, en de ACL en transform set moeten bestaan. |
| Peer onbereikbaar | Een route naar het publieke adres van de peer, aan beide kanten. |
| Geen crypto map bij peer / peer wijst ergens anders heen | Het peeradres is de interface waar de andere crypto map op staat, en `set peer` van die map wijst terug. |
| Geblokkeerd door ACL | Sta `udp eq isakmp` en `esp` tussen de peers toe. |
| Fase 1-policy verschilt | Versleuteling, hash, authenticatie en groep moeten aan beide kanten in een policy gelijk zijn. |
| Sleutel verschilt | Dezelfde pre-shared key aan beide kanten, elk voor het adres van de ander. |
| Fase 2 verschilt | Een transform set met dezelfde transforms en modus, en dezelfde PFS-groep. |
| Crypto-ACL niet gespiegeld | De ACL's moeten elkaars spiegelbeeld zijn. |
