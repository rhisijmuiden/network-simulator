import { newId } from "./catalog.js";
import type { Check, LessonText } from "./lessons.js";
import type { Device, Interface, Topology } from "./model.js";
import type { IpsecConfig } from "./protocols/ipsec.js";
import { createFromTemplate } from "./templates.js";

/**
 * Built-in troubleshooting assignments. Each one starts from a template with one or more
 * faults planted in it; the checks describe the working network, not the fix, so every
 * correct solution passes.
 */
export interface BuiltinScenario {
  key: string;
  /** 1 = basics, 2 = intermediate, 3 = advanced. */
  level: 1 | 2 | 3;
  topics: string[];
  title: LessonText;
  briefing: LessonText;
  hints: LessonText[];
  build(): Topology;
  checks: Check[];
}

const dev = (t: Topology, name: string): Device => t.devices.find((d) => d.name === name)!;
const ifc = (d: Device, name: string): Interface => d.interfaces.find((i) => i.name === name)!;

export const BUILTIN_SCENARIOS: BuiltinScenario[] = [
  {
    key: "same-lan",
    level: 1,
    topics: ["ip"],
    title: { en: "PC2 cannot reach its neighbours", nl: "PC2 bereikt zijn buren niet" },
    briefing: {
      en: "PC1, PC2 and the server are on the same switch. PC1 and the server talk to each other, but PC2 reaches nobody. Find the fault and fix it, without changing PC1 or the server.",
      nl: "PC1, PC2 en de server hangen aan dezelfde switch. PC1 en de server bereiken elkaar, maar PC2 bereikt niemand. Zoek de fout en los hem op, zonder PC1 of de server te wijzigen.",
    },
    hints: [
      { en: "Compare the IP settings of PC2 with those of PC1 (ipconfig).", nl: "Vergelijk de IP-instellingen van PC2 met die van PC1 (ipconfig)." },
      { en: "Devices in one LAN need addresses in the same subnet: 192.168.1.0/24.", nl: "Apparaten in één LAN hebben adressen in hetzelfde subnet nodig: 192.168.1.0/24." },
    ],
    build() {
      const t = createFromTemplate("switched");
      dev(t, "PC2").interfaces[0]!.ip = { address: "192.168.10.11", prefix: 24 };
      return t;
    },
    checks: [
      { id: "c1", type: "ping", from: "PC2", to: "PC1", expect: "reach" },
      { id: "c2", type: "ping", from: "PC2", to: "SRV1", expect: "reach" },
      { id: "c3", type: "ping", from: "PC1", to: "SRV1", expect: "reach" },
    ],
  },
  {
    key: "gateway",
    level: 1,
    topics: ["ip", "routing"],
    title: { en: "The server is out of reach", nl: "De server is onbereikbaar" },
    briefing: {
      en: "PC1 can ping its own router, but not the server in the other network. The routers are configured correctly. Make PC1 reach the server.",
      nl: "PC1 kan zijn eigen router pingen, maar niet de server in het andere netwerk. De routers zijn goed ingesteld. Zorg dat PC1 de server bereikt.",
    },
    hints: [
      { en: "How does PC1 send traffic to another network? Look at ipconfig.", nl: "Hoe stuurt PC1 verkeer naar een ander netwerk? Kijk naar ipconfig." },
      { en: "The default gateway must be the address of the router in PC1's own subnet.", nl: "De default gateway moet het adres van de router in het eigen subnet van PC1 zijn." },
    ],
    build() {
      const t = createFromTemplate("routed");
      dev(t, "PC1").defaultGateway = "10.1.0.254";
      return t;
    },
    checks: [
      { id: "c1", type: "ping", from: "PC1", to: "10.1.0.1", expect: "reach" },
      { id: "c2", type: "ping", from: "PC1", to: "SRV1", expect: "reach" },
    ],
  },
  {
    key: "return-route",
    level: 2,
    topics: ["routing"],
    title: { en: "Ping goes out, nothing comes back", nl: "De ping gaat weg, er komt niets terug" },
    briefing: {
      en: "From PC1 the ping to the server times out. In the simulation you can see the echo request arrive at the server. Find out why the reply gets lost and fix it on the routers.",
      nl: "Vanaf PC1 krijgt de ping naar de server een time-out. In de simulatie zie je het echo request wel bij de server aankomen. Zoek uit waarom het antwoord verdwijnt en los het op in de routers.",
    },
    hints: [
      { en: "Traffic needs a route in both directions. Look at show ip route on R2.", nl: "Verkeer heeft in beide richtingen een route nodig. Bekijk show ip route op R2." },
      { en: "R2 does not know where 10.1.0.0/24 is. Add a static route via R1 (172.16.0.1).", nl: "R2 weet niet waar 10.1.0.0/24 ligt. Voeg een statische route toe via R1 (172.16.0.1)." },
    ],
    build() {
      const t = createFromTemplate("routed");
      dev(t, "R2").staticRoutes = [];
      return t;
    },
    checks: [
      { id: "c1", type: "route", device: "R2", network: "10.1.0.0/24" },
      { id: "c2", type: "ping", from: "PC1", to: "SRV1", expect: "reach" },
    ],
  },
  {
    key: "vlan-trunk",
    level: 2,
    topics: ["vlan"],
    title: { en: "Guests have no network", nl: "Gasten hebben geen netwerk" },
    briefing: {
      en: "Staff (PC10, VLAN 10) and guests (PC20, VLAN 20) are routed by R1 on one cable (router on a stick). Since a change on the switch, PC20 cannot reach its gateway and PC10 cannot reach PC20. Fix the switch.",
      nl: "Medewerkers (PC10, VLAN 10) en gasten (PC20, VLAN 20) worden door R1 over één kabel gerouteerd (router on a stick). Sinds een wijziging op de switch bereikt PC20 zijn gateway niet en bereikt PC10 PC20 niet. Herstel de switch.",
    },
    hints: [
      { en: "Check which VLANs the link to R1 carries: show interfaces trunk.", nl: "Controleer welke VLAN's de verbinding naar R1 doorgeeft: show interfaces trunk." },
      { en: "VLAN 20 is not allowed on the trunk. Use switchport trunk allowed vlan.", nl: "VLAN 20 is niet toegestaan op de trunk. Gebruik switchport trunk allowed vlan." },
    ],
    build() {
      const t = createFromTemplate("vlans");
      ifc(dev(t, "SW1"), "GigabitEthernet0/1").allowedVlans = "10";
      return t;
    },
    checks: [
      { id: "c1", type: "ping", from: "PC20", to: "10.0.20.1", expect: "reach" },
      { id: "c2", type: "ping", from: "PC10", to: "PC20", expect: "reach" },
    ],
  },
  {
    key: "ospf-adjacency",
    level: 2,
    topics: ["ospf"],
    title: { en: "OSPF neighbours are missing", nl: "OSPF-buren ontbreken" },
    briefing: {
      en: "The three routers run OSPF, but R3 has no neighbours and PC3 cannot reach the server. Get every router to form an adjacency with the other two and restore the connection.",
      nl: "De drie routers draaien OSPF, maar R3 heeft geen buren en PC3 bereikt de server niet. Zorg dat elke router een adjacency vormt met de andere twee en herstel de verbinding.",
    },
    hints: [
      { en: "show ip ospf on R1 or R2 lists routers that are seen but not neighbours, with the reason.", nl: "show ip ospf op R1 of R2 toont routers die wel gezien worden maar geen buur zijn, met de reden." },
      { en: "Compare the network ... area statements on R3 with the other routers, and look for passive-interface.", nl: "Vergelijk de network ... area-regels op R3 met de andere routers en zoek naar passive-interface." },
    ],
    build() {
      const t = createFromTemplate("ospf");
      const r3 = dev(t, "R3");
      r3.protocols.ospf = {
        processId: 1,
        routerId: "3.3.3.3",
        networks: [{ address: "10.0.0.0", wildcard: "0.255.255.255", area: 1 }],
        passive: [r3.interfaces[0]!.id, ifc(r3, "GigabitEthernet0/2").id],
        costs: {},
      };
      return t;
    },
    checks: [
      { id: "c1", type: "ospf", device: "R3", neighbor: "R1" },
      { id: "c2", type: "ospf", device: "R3", neighbor: "R2" },
      { id: "c3", type: "ping", from: "PC3", to: "SRV1", expect: "reach" },
    ],
  },
  {
    key: "dhcp-relay",
    level: 2,
    topics: ["dhcp", "services"],
    title: { en: "Office PCs get 169.254 addresses", nl: "Kantoor-pc's krijgen 169.254-adressen" },
    briefing: {
      en: "The PCs in the office get their address from the DHCP server SRV1 in the server network. Since R1 was replaced they show 169.254.x.x and cannot open the intranet. Fix it without moving the server.",
      nl: "De pc's op kantoor krijgen hun adres van DHCP-server SRV1 in het servernetwerk. Sinds R1 vervangen is tonen ze 169.254.x.x en kunnen ze het intranet niet openen. Los het op zonder de server te verplaatsen.",
    },
    hints: [
      { en: "DHCP requests are broadcasts. Routers do not forward broadcasts by default.", nl: "DHCP-verzoeken zijn broadcasts. Routers sturen broadcasts standaard niet door." },
      { en: "On the router interface facing the PCs: ip helper-address 10.2.0.10.", nl: "Op de routerinterface aan de kant van de pc's: ip helper-address 10.2.0.10." },
    ],
    build() {
      const t = createFromTemplate("services");
      delete ifc(dev(t, "R1"), "GigabitEthernet0/0").helperAddress;
      return t;
    },
    checks: [
      { id: "c1", type: "dhcp", device: "PC1" },
      { id: "c2", type: "dhcp", device: "PC2" },
      { id: "c3", type: "tcp", from: "PC1", to: "SRV1", port: 80, expect: "open" },
    ],
  },
  {
    key: "acl-web",
    level: 3,
    topics: ["acl"],
    title: { en: "The intranet is blocked", nl: "Het intranet is geblokkeerd" },
    briefing: {
      en: "Security asked for FTP from the office to the server to be blocked. Since then the intranet website does not open either. Make the website work again; FTP must stay blocked.",
      nl: "Security vroeg om FTP van kantoor naar de server te blokkeren. Sindsdien opent ook de intranetsite niet meer. Zorg dat de website weer werkt; FTP moet geblokkeerd blijven.",
    },
    hints: [
      { en: "Look at show access-lists on R1 and at the interface where the list is applied.", nl: "Bekijk show access-lists op R1 en de interface waarop de lijst staat." },
      { en: "One rule denies www as well. Only ftp (port 21) should be denied.", nl: "Eén regel weigert ook www. Alleen ftp (poort 21) moet geweigerd worden." },
    ],
    build() {
      const t = createFromTemplate("services");
      const r1 = dev(t, "R1");
      const any = { address: "0.0.0.0", wildcard: "255.255.255.255" };
      const srv = { address: "10.2.0.10", wildcard: "0.0.0.0" };
      r1.acls.push({
        name: "OFFICE-IN",
        type: "extended",
        rules: [
          { id: newId("a"), action: "deny", protocol: "tcp", src: any, dst: srv, dstPort: { op: "eq", from: 21 } },
          { id: newId("a"), action: "deny", protocol: "tcp", src: any, dst: srv, dstPort: { op: "eq", from: 80 } },
          { id: newId("a"), action: "permit", protocol: "ip", src: any, dst: any },
        ],
      });
      ifc(r1, "GigabitEthernet0/0").aclIn = "OFFICE-IN";
      return t;
    },
    checks: [
      { id: "c1", type: "tcp", from: "PC1", to: "SRV1", port: 80, expect: "open" },
      { id: "c2", type: "tcp", from: "PC1", to: "SRV1", port: 21, expect: "blocked" },
      { id: "c3", type: "ping", from: "PC1", to: "SRV1", expect: "reach" },
    ],
  },
  {
    key: "bgp-peering",
    level: 3,
    topics: ["bgp"],
    title: { en: "The BGP session stays down", nl: "De BGP-sessie blijft down" },
    briefing: {
      en: "AS 65001 (R1) and AS 65002 (R2) exchange their networks over eBGP. After a change the session no longer comes up and PC1 cannot reach the server. Restore the peering.",
      nl: "AS 65001 (R1) en AS 65002 (R2) wisselen hun netwerken uit via eBGP. Na een wijziging komt de sessie niet meer op en bereikt PC1 de server niet. Herstel de peering.",
    },
    hints: [
      { en: "show ip bgp summary shows the neighbour state on both routers.", nl: "show ip bgp summary toont de status van de buur op beide routers." },
      { en: "The remote-as on R2 must be the AS number that R1 really uses.", nl: "De remote-as op R2 moet het AS-nummer zijn dat R1 echt gebruikt." },
    ],
    build() {
      const t = createFromTemplate("bgp");
      (dev(t, "R2").protocols.bgp as { neighbors: { remoteAs: number }[] }).neighbors[0]!.remoteAs = 65010;
      return t;
    },
    checks: [
      { id: "c1", type: "bgp", device: "R1", peer: "192.0.2.2" },
      { id: "c2", type: "bgp", device: "R2", peer: "192.0.2.1" },
      { id: "c3", type: "ping", from: "PC1", to: "SRV1", expect: "reach" },
    ],
  },
  {
    key: "vpn-down",
    level: 3,
    topics: ["ipsec"],
    title: { en: "The VPN between the sites is down", nl: "De VPN tussen de locaties ligt eruit" },
    briefing: {
      en: "Site 1 (PC1) reaches the server at site 2 through an IPsec tunnel. A colleague changed R2 and now the tunnel stays down. Two things are wrong. Fix them so PC1 reaches SRV1 through the tunnel.",
      nl: "Locatie 1 (PC1) bereikt de server op locatie 2 via een IPsec-tunnel. Een collega heeft R2 aangepast en nu blijft de tunnel down. Er zijn twee dingen fout. Herstel ze zodat PC1 SRV1 via de tunnel bereikt.",
    },
    hints: [
      { en: "Start with show crypto session on R1 or R2: it names the reason.", nl: "Begin met show crypto session op R1 of R2: daar staat de reden." },
      { en: "Compare the pre-shared keys (show running-config) on both routers.", nl: "Vergelijk de pre-shared keys (show run, crypto isakmp key) op beide routers." },
      { en: "The crypto ACLs must be mirror images: R2 protects 10.2.0.0/24 to 10.1.0.0/24.", nl: "De crypto-ACL's moeten spiegelbeelden zijn: R2 beschermt 10.2.0.0/24 naar 10.1.0.0/24." },
    ],
    build() {
      const t = createFromTemplate("ipsec");
      const r2 = dev(t, "R2");
      (r2.protocols.ipsec as IpsecConfig).keys[0]!.key = "Lab-Secret2";
      r2.acls[0]!.rules[0]!.dst = { address: "10.1.1.0", wildcard: "0.0.0.255" };
      return t;
    },
    checks: [
      { id: "c1", type: "ipsec", device: "R1" },
      { id: "c2", type: "ipsec", device: "R2" },
      { id: "c3", type: "ping", from: "PC1", to: "SRV1", expect: "reach" },
    ],
  },
];

export function builtinScenario(key: string): BuiltinScenario | undefined {
  return BUILTIN_SCENARIOS.find((s) => s.key === key);
}
