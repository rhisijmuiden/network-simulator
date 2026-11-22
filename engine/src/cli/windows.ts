import { isIp, maskToPrefix, parseIp, prefixToMask } from "../ip.js";
import type { Device, Interface, Topology } from "../model.js";
import type { OperationRun, Simulator } from "../simulator.js";
import { dnsLookup, type Lease } from "../services.js";

/**
 * Command prompt for PCs and servers, in the style of the Windows command line:
 * ipconfig, ping, tracert, arp, nslookup, netsh, curl, net view, dir, ftp and telnet.
 * Like the router console it returns an updated topology for configuration changes.
 */
export interface CmdResult {
  output: string[];
  topology?: Topology;
  run?: OperationRun;
  /** `cls`: the console clears its screen. */
  clear?: boolean;
}

const HELP = [
  "Commands:",
  "  ipconfig [/all | /release | /renew]   Show or renew the IP configuration",
  "  ping [-n count] <host>                Send echo requests",
  "  tracert <host>                        Trace the route to a host",
  "  arp -a                                Show the ARP cache",
  "  nslookup <name> [server]              Look a name up in DNS",
  "  netsh interface ip set address \"Ethernet0\" static <ip> <mask> [gateway]",
  "  netsh interface ip set address \"Ethernet0\" dhcp",
  "  netsh interface ip set dns \"Ethernet0\" static <server> | dhcp",
  "  curl http://<host>/                   Fetch a web page",
  "  net view \\\\<server>                    List the shares of a file server",
  "  dir \\\\<server>\\<share>                 List the files in a share",
  "  ftp <host>                            Connect to an FTP server",
  "  telnet <host> <port>                  Test a TCP port",
  "  hostname, cls, help",
];

const MAX_HISTORY = 100;

export class WindowsSession {
  history: string[] = [];

  constructor(readonly deviceId: string) {}

  prompt(topology: Topology): string {
    const d = topology.devices.find((x) => x.id === this.deviceId);
    return d?.kind === "server" ? "C:\\Users\\Administrator>" : "C:\\Users\\student>";
  }

  execute(input: string, env: { topology: Topology; sim: Simulator }): CmdResult {
    const line = input.trim();
    if (!line) return { output: [] };
    if (line !== this.history.at(-1)) this.history.push(line);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    const draft = JSON.parse(JSON.stringify(env.topology)) as Topology;
    const d = draft.devices.find((x) => x.id === this.deviceId);
    const live = env.sim.topology.devices.find((x) => x.id === this.deviceId);
    if (!d || !live) return { output: ["The device no longer exists."] };
    const args = splitArgs(line);
    const cmd = args.shift()!.toLowerCase().replace(/\.exe$/, "");
    const c: Run = { d, live, sim: env.sim, out: [], dirty: false };
    switch (cmd) {
      case "ipconfig":
        ipconfig(c, args);
        break;
      case "ping":
        ping(c, args);
        break;
      case "tracert":
        tracert(c, args);
        break;
      case "arp":
        arp(c, args);
        break;
      case "nslookup":
        nslookup(c, args);
        break;
      case "netsh":
        netsh(c, args);
        break;
      case "curl":
        curl(c, args);
        break;
      case "net":
        netView(c, args);
        break;
      case "dir":
        dir(c, args);
        break;
      case "ftp":
        ftp(c, args);
        break;
      case "telnet":
        telnet(c, args);
        break;
      case "hostname":
        c.out.push(d.name);
        break;
      case "cls":
        return { output: [], clear: true };
      case "help":
      case "/?":
      case "?":
        c.out.push(...HELP);
        break;
      case "exit":
        break;
      default:
        c.out.push(`'${cmd}' is not recognized as an internal or external command,`, "operable program or batch file.", "Type help for the commands of this simulator.");
    }
    // Like cmd.exe: an empty line between the output and the next prompt.
    if (c.out.length) c.out.push("");
    return { output: c.out, topology: c.dirty ? draft : undefined, run: c.run };
  }

  /** Completes the command word. */
  complete(input: string): string | null {
    const m = /^(\s*)(\S+)$/.exec(input);
    if (!m) return null;
    const words = ["ipconfig", "ping", "tracert", "arp", "nslookup", "netsh", "curl", "net", "dir", "ftp", "telnet", "hostname", "cls", "help"];
    const hits = words.filter((w) => w.startsWith(m[2]!.toLowerCase()));
    return hits.length === 1 ? `${m[1]}${hits[0]} ` : null;
  }
}

interface Run {
  /** Draft copy of the configured device: changes go here. */
  d: Device;
  /** The device as simulated (with its DHCP lease applied). */
  live: Device;
  sim: Simulator;
  out: string[];
  dirty: boolean;
  run?: OperationRun;
}

/** Splits on spaces, keeping "quoted words" together. */
function splitArgs(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

function nic(d: Device): Interface | undefined {
  return d.interfaces.find((i) => i.type === "ethernet");
}

function adapterName(i: Interface): string {
  return i.name;
}

function lease(c: Run, i: Interface): Lease | undefined {
  const l = c.sim.leases.get(i.id);
  return l && "address" in l ? l : undefined;
}

// ---------------------------------------------------------------- ipconfig

function ipconfig(c: Run, args: string[]) {
  const flag = args[0]?.toLowerCase();
  const all = flag === "/all";
  if (flag === "/release" || flag === "/renew") {
    const dhcpNics = c.d.interfaces.filter((i) => i.dhcp);
    if (!dhcpNics.length) return void c.out.push("", "The operation failed as no adapter is in the state permissible for this operation.");
    if (flag === "/release") {
      // The simulator is always converged: show the release, the lease comes back on the next command.
      c.out.push("", "Windows IP Configuration", "", "The DHCP lease was released. The simulator renews it straight away; use ipconfig to see it.");
      return;
    }
    c.out.push("", "Windows IP Configuration");
    for (const i of dhcpNics) {
      const l = c.sim.leases.get(i.id);
      if (!l || !("address" in l)) c.out.push("", `An error occurred while renewing interface ${adapterName(i)} : unable to contact your DHCP server. Request has timed out.`);
    }
    showAdapters(c, false);
    return;
  }
  if (flag && !all) return void c.out.push("", "Error: unrecognized or incomplete command line.", "", "USAGE:", "    ipconfig [/all | /release | /renew]");
  c.out.push("", "Windows IP Configuration", "");
  if (all) {
    c.out.push(`   Host Name . . . . . . . . . . . . : ${c.live.name}`, "   Node Type . . . . . . . . . . . . : Hybrid", "   IP Routing Enabled. . . . . . . . : No", "");
  }
  showAdapters(c, all);
}

function showAdapters(c: Run, all: boolean) {
  for (const i of c.live.interfaces.filter((x) => x.type === "ethernet")) {
    const up = c.sim.net.isUp(i);
    c.out.push("", `Ethernet adapter ${adapterName(i)}:`, "");
    if (!up) {
      c.out.push("   Media State . . . . . . . . . . . : Media disconnected", "   Connection-specific DNS Suffix  . :");
      continue;
    }
    const l = lease(c, i);
    const failed = i.dhcp && !l;
    c.out.push("   Connection-specific DNS Suffix  . :");
    if (all) {
      c.out.push(`   Description . . . . . . . . . . . : Simulated Ethernet adapter`, `   Physical Address. . . . . . . . . : ${i.mac.toUpperCase().replace(/:/g, "-")}`, `   DHCP Enabled. . . . . . . . . . . : ${i.dhcp ? "Yes" : "No"}`);
    }
    if (failed) {
      // Windows falls back to an APIPA address when no DHCP server answers.
      const apipa = `169.254.${parseInt(i.mac.slice(12, 14), 16)}.${parseInt(i.mac.slice(15, 17), 16) || 1}`;
      c.out.push(`   Autoconfiguration IPv4 Address. . : ${apipa}`, "   Subnet Mask . . . . . . . . . . . : 255.255.0.0", "   Default Gateway . . . . . . . . . :");
      continue;
    }
    if (i.ip) {
      c.out.push(`   IPv4 Address. . . . . . . . . . . : ${i.ip.address}`, `   Subnet Mask . . . . . . . . . . . : ${prefixToMask(i.ip.prefix)}`);
    }
    c.out.push(`   Default Gateway . . . . . . . . . : ${c.live.defaultGateway ?? ""}`);
    if (all) {
      if (l) c.out.push(`   DHCP Server . . . . . . . . . . . : ${serverAddress(c, l)}`);
      const dns = c.live.dnsServers ?? [];
      c.out.push(`   DNS Servers . . . . . . . . . . . : ${dns[0] ?? ""}`, ...dns.slice(1).map((x) => `                                       ${x}`));
    }
  }
}

function serverAddress(c: Run, l: Lease): string {
  const s = c.sim.topology.devices.find((x) => x.id === l.server);
  return s?.interfaces.find((i) => i.ip)?.ip?.address ?? "";
}

// ---------------------------------------------------------------- name resolution

/** Resolves a host name through the configured DNS server; addresses pass through. */
function resolve(c: Run, name: string): { address?: string; error?: string } {
  if (isIp(name)) return { address: name };
  if (name.toLowerCase() === c.live.name.toLowerCase() || name.toLowerCase() === "localhost") {
    const ip = nic(c.live)?.ip?.address;
    return ip ? { address: name.toLowerCase() === "localhost" ? "127.0.0.1" : ip } : {};
  }
  const r = query(c, name, c.live.dnsServers?.[0]);
  return r.address ? { address: r.address } : { error: r.error };
}

function query(c: Run, name: string, server: string | undefined): { address?: string; error?: string; serverName?: string } {
  if (!server) return { error: "noDns" };
  const q = c.sim.udpQuery(c.live.id, server, 53);
  c.run = q;
  if (q.result.status !== "answered") return { error: "timeout" };
  const owner = c.sim.net.ownerOf(parseIp(server)!)?.device;
  const address = owner ? dnsLookup(owner, name) : undefined;
  return address ? { address, serverName: owner?.name } : { error: "nxdomain", serverName: owner?.name };
}

function nslookup(c: Run, args: string[]) {
  const name = args[0];
  if (!name) return void c.out.push("Usage: nslookup <name> [server]");
  const server = args[1] ?? c.live.dnsServers?.[0];
  if (!server) return void c.out.push("*** Default servers are not available", "Server:  UnKnown", "Address:  127.0.0.1", "", `*** UnKnown can't find ${name}: No response from server`);
  const r = query(c, name, server);
  const sname = r.serverName ?? "UnKnown";
  if (r.error === "timeout") return void c.out.push("DNS request timed out.", "    timeout was 2 seconds.", `Server:  ${sname}`, `Address:  ${server}`, "", `*** Request to ${sname} timed-out`);
  c.out.push(`Server:  ${sname}`, `Address:  ${server}`, "");
  if (r.address) c.out.push(`Name:    ${name}`, `Address:  ${r.address}`);
  else c.out.push(`*** ${sname} can't find ${name}: Non-existent domain`);
}

function unresolved(c: Run, name: string, error?: string) {
  c.out.push(error === "noDns" || error === "timeout" || error === "nxdomain" ? `Ping request could not find host ${name}. Please check the name and try again.` : `Unknown host ${name}.`);
}

// ---------------------------------------------------------------- ping / tracert / arp

function ping(c: Run, args: string[]) {
  let count = 4;
  const rest: string[] = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!.toLowerCase();
    if (a === "-n") count = Math.max(1, Math.min(10, Number(args[++k]) || 4));
    else if (a === "-t") count = 10;
    else rest.push(args[k]!);
  }
  const target = rest[0];
  if (!target) return void c.out.push("", "Usage: ping [-n count] target_name");
  const r = resolve(c, target);
  if (!r.address) return unresolved(c, target, r.error);
  if (r.address === "127.0.0.1") {
    c.out.push("", `Pinging ${target} [127.0.0.1] with 32 bytes of data:`, ...Array.from({ length: count }, () => "Reply from 127.0.0.1: bytes=32 time<1ms TTL=128"));
    return;
  }
  const run = c.sim.ping(c.live.id, r.address, { count });
  c.run = run;
  const shown = isIp(target) ? r.address : `${target} [${r.address}]`;
  c.out.push("", `Pinging ${shown} with 32 bytes of data:`);
  const owner = c.sim.net.ownerOf(parseIp(r.address)!)?.device;
  const ttl = owner && (owner.kind === "pc" || owner.kind === "server") ? 128 : 255;
  for (const x of run.result.replies) {
    if (x.status === "reply") c.out.push(`Reply from ${r.address}: bytes=32 time=${x.time ?? 1}ms TTL=${ttl}`);
    else if (x.status === "timeout") c.out.push("Request timed out.");
    else if (x.status === "ttl-expired") c.out.push(`Reply from ${x.from ?? "?"}: TTL expired in transit.`);
    else if (x.code === "admin") c.out.push(`Reply from ${x.from ?? "?"}: Communication administratively prohibited.`);
    else if (x.status === "unreachable" && !x.from) c.out.push("PING: transmit failed. General failure.");
    else c.out.push(`Reply from ${x.from ?? "?"}: Destination ${x.code === "net" ? "net" : "host"} unreachable.`);
  }
  const ok = run.result.received;
  const lost = run.result.sent - ok;
  const times = run.result.replies.filter((x) => x.status === "reply" && x.time !== undefined).map((x) => x.time!);
  c.out.push("", `Ping statistics for ${r.address}:`, `    Packets: Sent = ${run.result.sent}, Received = ${ok}, Lost = ${lost} (${Math.round((lost / run.result.sent) * 100)}% loss),`);
  if (times.length)
    c.out.push("Approximate round trip times in milli-seconds:", `    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Average = ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);
}

function tracert(c: Run, args: string[]) {
  const target = args.find((a) => !a.startsWith("-"));
  if (!target) return void c.out.push("", "Usage: tracert target_name");
  const r = resolve(c, target);
  if (!r.address) return void c.out.push(`Unable to resolve target system name ${target}.`);
  const run = c.sim.traceroute(c.live.id, r.address, { maxHops: 30 });
  c.run = run;
  c.out.push("", `Tracing route to ${isIp(target) ? r.address : `${target} [${r.address}]`}`, "over a maximum of 30 hops:", "");
  for (const h of run.result.hops) {
    if (h.status === "timeout") c.out.push(`${String(h.ttl).padStart(3)}     *        *        *     Request timed out.`);
    else c.out.push(`${String(h.ttl).padStart(3)}    <1 ms    <1 ms    <1 ms  ${h.address}${h.status === "unreachable" ? "  reports: Destination host unreachable." : ""}`);
  }
  c.out.push("", "Trace complete.");
}

function arp(c: Run, args: string[]) {
  if (!args[0] || !["-a", "-g", "/a"].includes(args[0].toLowerCase())) return void c.out.push("", "Displays and modifies the IP-to-Physical address translation tables.", "", "ARP -a");
  const i = nic(c.live);
  if (!i?.ip) return void c.out.push("No ARP Entries Found.");
  const entries = c.sim.arpTable(c.live.id);
  if (!entries.length) return void c.out.push("No ARP Entries Found.");
  c.out.push("", `Interface: ${i.ip.address} --- 0x${(c.live.interfaces.indexOf(i) + 2).toString(16)}`, "  Internet Address      Physical Address      Type");
  for (const e of entries) c.out.push(`  ${e.ip.padEnd(22)}${e.mac.replace(/:/g, "-").padEnd(22)}dynamic`);
}

// ---------------------------------------------------------------- netsh

function netsh(c: Run, args: string[]) {
  const a = args.map((x) => x.toLowerCase());
  const usage = () => c.out.push("The syntax supplied for this command is not valid. Check help for the correct syntax.", "", ...HELP.filter((h) => h.includes("netsh")));
  if (a[0] !== "interface" || !["ip", "ipv4"].includes(a[1] ?? "") || a[2] !== "set") return usage();
  const what = a[3];
  const adapter = args[4];
  const i = c.d.interfaces.find((x) => x.type === "ethernet" && adapter && x.name.toLowerCase() === adapter.toLowerCase());
  if (!i) return void c.out.push(`The interface "${adapter ?? ""}" was not found. Use ipconfig to see the adapter names.`);
  if (what === "address") {
    const mode = a[5];
    if (mode === "dhcp") {
      i.dhcp = true;
      delete i.ip;
      delete c.d.defaultGateway;
    } else if (mode === "static") {
      const [ip, mask, gw] = [args[6], args[7], args[8]];
      if (!ip || !mask || !isIp(ip) || maskToPrefix(mask) === null || (gw && !isIp(gw))) return usage();
      i.dhcp = false;
      i.ip = { address: ip, prefix: maskToPrefix(mask)! };
      if (gw) c.d.defaultGateway = gw;
      else delete c.d.defaultGateway;
    } else return usage();
    c.dirty = true;
    c.out.push("Ok.");
    return;
  }
  if (what === "dns" || what === "dnsservers") {
    const mode = a[5];
    if (mode === "dhcp") delete c.d.dnsServers;
    else if (mode === "static" && args[6] && isIp(args[6])) c.d.dnsServers = [args[6]];
    else return usage();
    c.dirty = true;
    c.out.push("Ok.");
    return;
  }
  usage();
}

// ---------------------------------------------------------------- applications

/** TCP connect to a host:port; prints Windows-style errors and returns the server device on success. */
function connect(c: Run, host: string, port: number, fail: (reason: string) => void): Device | undefined {
  const r = resolve(c, host);
  if (!r.address) {
    fail(`Could not resolve host: ${host}`);
    return undefined;
  }
  const run = c.sim.tcpConnect(c.live.id, r.address, port);
  c.run = run;
  const st = run.result.status;
  if (st === "open") return c.sim.net.ownerOf(parseIp(r.address)!)?.device;
  fail(st === "closed" ? `Failed to connect to ${host} port ${port}: Connection refused` : `Failed to connect to ${host} port ${port}: Timed out`);
  return undefined;
}

function curl(c: Run, args: string[]) {
  const url = args.find((a) => !a.startsWith("-"));
  if (!url) return void c.out.push("curl: try 'curl http://<host>/'");
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/i.exec(url);
  if (!m) return void c.out.push(`curl: (3) URL using bad/illegal format or missing URL`);
  const port = m[3] ? Number(m[3]) : m[1]?.toLowerCase() === "https" ? 443 : 80;
  const server = connect(c, m[2]!, port, (msg) => c.out.push(`curl: (7) ${msg}`));
  if (!server) return;
  const web = server.services?.web;
  if (!web?.enabled) return void c.out.push("curl: (52) Empty reply from server");
  c.out.push("<!DOCTYPE html>", `<html><head><title>${web.title}</title></head>`, "<body>", ...web.body.split("\n"), "</body></html>");
}

function netView(c: Run, args: string[]) {
  if (args[0]?.toLowerCase() !== "view" || !args[1]?.startsWith("\\\\")) return void c.out.push("The syntax of this command is:", "", "NET VIEW \\\\computername");
  const host = args[1].slice(2);
  const server = connect(c, host, 445, () => c.out.push("System error 53 has occurred.", "", "The network path was not found."));
  if (!server) return;
  const files = server.services?.files;
  if (!files?.enabled) return void c.out.push("There are no entries in the list.");
  c.out.push(`Shared resources at \\\\${host}`, "", "Share name  Type  Used as  Comment", "", "-------------------------------------------------------------------------------");
  for (const s of files.shares) c.out.push(`${s.name.padEnd(12)}Disk`);
  c.out.push("The command completed successfully.");
}

function dir(c: Run, args: string[]) {
  const path = args.find((a) => !a.startsWith("/"));
  if (!path || !path.startsWith("\\\\")) return void c.out.push(" Volume in drive C has no label.", "", " Directory of C:\\Users\\student", "", "               0 File(s)              0 bytes");
  const [host, share] = path.slice(2).split("\\");
  if (!host || !share) return void c.out.push("The network name cannot be found.");
  const server = connect(c, host, 445, () => c.out.push("The network path was not found."));
  if (!server) return;
  const s = server.services?.files?.enabled ? server.services.files.shares.find((x) => x.name.toLowerCase() === share.toLowerCase()) : undefined;
  if (!s) return void c.out.push("The network name cannot be found.");
  c.out.push(` Directory of ${path}`, "");
  for (const f of s.files) c.out.push(`22/11/2026  09:00            12.288 ${f}`);
  c.out.push(`               ${s.files.length} File(s)`);
}

function ftp(c: Run, args: string[]) {
  const host = args[0];
  if (!host) return void c.out.push("Usage: ftp <host>");
  const server = connect(c, host, 21, (msg) => c.out.push(`> ftp: connect :${msg.includes("refused") ? "Connection refused" : "Connection timed out"}`));
  if (!server) return;
  c.out.push(`Connected to ${host}.`, `220 ${server.name} FTP server ready.`, "User (anonymous): anonymous", "230 Login successful.");
  for (const s of server.services?.files?.shares ?? []) c.out.push(`drwxr-xr-x  ${s.name}`);
  c.out.push("221 Goodbye.");
}

function telnet(c: Run, args: string[]) {
  const [host, p] = args;
  if (!host) return void c.out.push("Usage: telnet <host> [port]");
  const port = Number(p ?? 23);
  if (connect(c, host, port, (msg) => c.out.push(`Connecting To ${host}...Could not open connection to the host, on port ${port}: ${msg.includes("refused") ? "Connect failed" : "Connect timed out"}`)))
    c.out.push(`Connecting To ${host}... connected to port ${port}. Connection closed by foreign host.`);
}

