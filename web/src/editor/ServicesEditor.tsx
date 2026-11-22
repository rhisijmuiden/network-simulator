import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { networkOf, newId, parseIp, formatIp, type Device, type DhcpPool, type Services } from "@netsim/engine";
import { Button, Toggle } from "../components/ui";
import { CommitInput, IconButton, Row, Section } from "./fields";
import { parseNetwork, parseOptionalIp, parsePortList } from "./parse";

type Set = (fn: (d: Device) => void) => void;

const required = (s: string) => (parseIp(s.trim()) === null ? undefined : s.trim());
const nonEmpty = (max: number) => (s: string) => (s.trim() && s.trim().length <= max ? s.trim() : undefined);

/** Services tab of a server: web, DNS, DHCP and file sharing, plus extra open ports. */
export function ServicesEditor({ device, set }: { device: Device; set: Set }) {
  const { t } = useTranslation();
  const s = device.services ?? {};
  const edit = (fn: (s: Services) => void) =>
    set((d) => {
      d.services ??= {};
      fn(d.services);
    });
  return (
    <>
      <Section title={t("services.web.title")}>
        <Toggle
          checked={!!s.web?.enabled}
          onChange={(v) => edit((x) => (x.web = { title: "Welcome", body: "<h1>It works!</h1>", ...x.web, enabled: v }))}
          label={t("services.web.enable")}
          description={t("services.web.hint")}
        />
        {s.web?.enabled && (
          <div className="mt-3 space-y-2">
            <Row label={t("services.web.pageTitle")}>
              <CommitInput value={s.web.title} parse={nonEmpty(200)} onCommit={(v) => edit((x) => void (x.web!.title = v))} />
            </Row>
            <Row label={t("services.web.body")}>
              <CommitTextarea value={s.web.body} onCommit={(v) => edit((x) => void (x.web!.body = v))} />
            </Row>
          </div>
        )}
      </Section>
      <DnsSection device={device} edit={edit} />
      <DhcpSection device={device} edit={edit} />
      <FilesSection device={device} edit={edit} />
      <Section title={t("services.ports.title")}>
        <Row label={t("inspector.listenPorts")} hint={t("services.ports.hint")}>
          <CommitInput mono value={device.listenPorts.join(", ")} placeholder="8080" parse={parsePortList} onCommit={(p) => set((d) => void (d.listenPorts = p))} />
        </Row>
      </Section>
    </>
  );
}

function CommitTextarea({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <textarea
      value={text}
      rows={4}
      maxLength={5000}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs focus:border-koraal focus:outline-none"
    />
  );
}

type Edit = (fn: (s: Services) => void) => void;

function DnsSection({ device, edit }: { device: Device; edit: Edit }) {
  const { t } = useTranslation();
  const dns = device.services?.dns;
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const ok = /^[a-z0-9.-]{1,253}$/i.test(name.trim()) && parseIp(addr.trim()) !== null;
  return (
    <Section title={t("services.dns.title")}>
      <Toggle checked={!!dns?.enabled} onChange={(v) => edit((x) => (x.dns = { records: [], ...x.dns, enabled: v }))} label={t("services.dns.enable")} description={t("services.dns.hint")} />
      {dns?.enabled && (
        <div className="mt-3 space-y-2">
          {dns.records.length === 0 && <p className="text-xs text-muted">{t("services.dns.none")}</p>}
          <ul className="space-y-1">
            {dns.records.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {r.name} → {r.address}
                </span>
                <IconButton title={t("common.delete")} danger onClick={() => edit((x) => void (x.dns!.records = x.dns!.records.filter((y) => y.id !== r.id)))}>
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="www.lab.local" aria-label={t("services.dns.name")} className={inputCls} />
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="10.0.0.10" aria-label={t("services.dns.address")} className={inputCls} />
            <IconButton
              title={t("services.dns.add")}
              disabled={!ok}
              onClick={() => {
                edit((x) => void x.dns!.records.push({ id: newId("n"), name: name.trim().toLowerCase(), address: addr.trim() }));
                setName("");
                setAddr("");
              }}
            >
              <Plus size={16} />
            </IconButton>
          </div>
        </div>
      )}
    </Section>
  );
}

function DhcpSection({ device, edit }: { device: Device; edit: Edit }) {
  const { t } = useTranslation();
  const dhcp = device.services?.dhcp;
  const own = device.interfaces.find((i) => i.ip)?.ip;
  const newPool = (): DhcpPool => {
    const ip = own ? parseIp(own.address)! : parseIp("192.168.1.10")!;
    const prefix = own?.prefix ?? 24;
    const net = networkOf(ip, prefix);
    return { id: newId("p"), name: `POOL${(dhcp?.pools.length ?? 0) + 1}`, network: formatIp(net), prefix, start: formatIp(net + 100), end: formatIp(net + 199), gateway: formatIp(net + 1), dns: own?.address };
  };
  const update = (id: string, fn: (p: DhcpPool) => void) => edit((x) => fn(x.dhcp!.pools.find((p) => p.id === id)!));
  return (
    <Section title={t("services.dhcp.title")}>
      <Toggle checked={!!dhcp?.enabled} onChange={(v) => edit((x) => (x.dhcp = { pools: [], ...x.dhcp, enabled: v }))} label={t("services.dhcp.enable")} description={t("services.dhcp.hint")} />
      {dhcp?.enabled && (
        <div className="mt-3 space-y-3">
          {dhcp.pools.map((p) => (
            <div key={p.id} className="space-y-2 rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <CommitInput value={p.name} ariaLabel={t("services.dhcp.name")} parse={nonEmpty(64)} onCommit={(v) => update(p.id, (x) => void (x.name = v))} className="font-semibold" />
                </div>
                <IconButton title={t("common.delete")} danger onClick={() => edit((x) => void (x.dhcp!.pools = x.dhcp!.pools.filter((y) => y.id !== p.id)))}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <Row label={t("services.dhcp.network")}>
                <CommitInput mono value={`${p.network}/${p.prefix}`} parse={parseNetwork} onCommit={(v) => update(p.id, (x) => Object.assign(x, v))} />
              </Row>
              <Row label={t("services.dhcp.start")}>
                <CommitInput mono value={p.start} parse={required} onCommit={(v) => update(p.id, (x) => void (x.start = v))} />
              </Row>
              <Row label={t("services.dhcp.end")}>
                <CommitInput mono value={p.end} parse={required} onCommit={(v) => update(p.id, (x) => void (x.end = v))} />
              </Row>
              <Row label={t("inspector.gateway")}>
                <CommitInput mono value={p.gateway ?? ""} parse={parseOptionalIp} onCommit={(v) => update(p.id, (x) => (v ? (x.gateway = v) : delete x.gateway))} />
              </Row>
              <Row label={t("services.dhcp.dns")}>
                <CommitInput mono value={p.dns ?? ""} parse={parseOptionalIp} onCommit={(v) => update(p.id, (x) => (v ? (x.dns = v) : delete x.dns))} />
              </Row>
            </div>
          ))}
          <Button size="sm" icon={<Plus size={14} />} onClick={() => edit((x) => void x.dhcp!.pools.push(newPool()))}>
            {t("services.dhcp.add")}
          </Button>
          <p className="text-xs text-muted">{t("services.dhcp.relay")}</p>
        </div>
      )}
    </Section>
  );
}

function FilesSection({ device, edit }: { device: Device; edit: Edit }) {
  const { t } = useTranslation();
  const files = device.services?.files;
  const parseFiles = (s: string) => {
    const list = s.split(",").map((x) => x.trim()).filter(Boolean);
    return list.length <= 200 && list.every((x) => x.length <= 200) ? list : undefined;
  };
  return (
    <Section title={t("services.files.title")}>
      <Toggle checked={!!files?.enabled} onChange={(v) => edit((x) => (x.files = { shares: [], ...x.files, enabled: v }))} label={t("services.files.enable")} description={t("services.files.hint")} />
      {files?.enabled && (
        <div className="mt-3 space-y-2">
          {files.shares.map((sh) => (
            <div key={sh.id} className="space-y-2 rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <CommitInput
                    value={sh.name}
                    ariaLabel={t("services.files.share")}
                    parse={(s) => (/^[\w$ -]{1,80}$/.test(s.trim()) ? s.trim() : undefined)}
                    onCommit={(v) => edit((x) => void (x.files!.shares.find((y) => y.id === sh.id)!.name = v))}
                    className="font-semibold"
                  />
                </div>
                <IconButton title={t("common.delete")} danger onClick={() => edit((x) => void (x.files!.shares = x.files!.shares.filter((y) => y.id !== sh.id)))}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <Row label={t("services.files.files")} hint={t("services.files.filesHint")}>
                <CommitInput value={sh.files.join(", ")} parse={parseFiles} onCommit={(v) => edit((x) => void (x.files!.shares.find((y) => y.id === sh.id)!.files = v))} />
              </Row>
            </div>
          ))}
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => edit((x) => void x.files!.shares.push({ id: newId("s"), name: `Share${x.files!.shares.length + 1}`, files: ["readme.txt"] }))}
          >
            {t("services.files.add")}
          </Button>
        </div>
      )}
    </Section>
  );
}

const inputCls = "min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs focus:border-koraal focus:outline-none";
