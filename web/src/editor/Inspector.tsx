import { ChevronDown, ChevronRight, Plus, TerminalSquare, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createLoopback,
  createSubinterface,
  createSvi,
  getModel,
  isHost,
  isSwitch,
  isSwitchport,
  newId,
  parseIp,
  shortName,
  type Device,
  type Interface,
  type Simulator,
  type Topology,
} from "@netsim/engine";
import { Badge, Button, Toggle } from "../components/ui";
import { AclEditor } from "./AclEditor";
import { hasConsole } from "./Console";
import { CommitInput, IconButton, MiniTable, Row, Section, SmallSelect } from "./fields";
import { DeviceIcon } from "./glyphs";
import { findDevice, removeDevice, removeIface, removeLink, updateDevice, updateIface, edit } from "./ops";
import { formatIfaceAddress, parseIfaceAddress, parseNetwork, parseOptionalIp, parsePortList, parseVlanId, parseVlanListInput } from "./parse";
import type { Selection } from "./Canvas";
import { StateView } from "./StateView";

type Props = {
  topology: Topology;
  sim: Simulator;
  selection: Selection;
  readOnly?: boolean;
  onChange: (t: Topology) => void;
  onSelect: (s: Selection) => void;
  onOpenConsole?: (deviceId: string) => void;
};

export function Inspector(props: Props) {
  const { topology, selection } = props;
  const { t } = useTranslation();
  if (!selection) return null;
  if (selection.type === "link") {
    const link = topology.links.find((l) => l.id === selection.id);
    if (!link) return null;
    return (
      <Panel title={t("editor.cable")} onClose={() => props.onSelect(null)}>
        <LinkPanel {...props} linkId={link.id} />
      </Panel>
    );
  }
  const device = findDevice(topology, selection.id);
  if (!device) return null;
  return <DevicePanel {...props} device={device} />;
}

function Panel({ title, icon, actions, onClose, children }: { title: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[360px] flex-col border-l border-line bg-raised shadow-xl lg:static lg:w-[360px] lg:shadow-none">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        {icon}
        <div className="min-w-0 flex-1">{title}</div>
        {actions}
        <IconButton title={t("common.close")} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

type Tab = "general" | "interfaces" | "routing" | "vlans" | "acls" | "state";

function DevicePanel(props: Props & { device: Device }) {
  const { device, topology, readOnly, onChange } = props;
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("general");
  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: t("inspector.tabs.general") },
    { id: "interfaces", label: t("inspector.tabs.interfaces") },
  ];
  if (device.kind === "router" || device.kind === "l3switch") tabs.push({ id: "routing", label: t("inspector.tabs.routing") });
  if (isSwitch(device)) tabs.push({ id: "vlans", label: t("inspector.tabs.vlans") });
  if (device.kind === "router" || device.kind === "l3switch") tabs.push({ id: "acls", label: t("inspector.tabs.acls") });
  tabs.push({ id: "state", label: t("inspector.tabs.state") });
  const current = tabs.some((x) => x.id === tab) ? tab : "general";
  const model = getModel(device.model);
  const set = (fn: (d: Device) => void) => onChange(updateDevice(topology, device.id, fn));

  return (
    <Panel
      icon={<DeviceIcon kind={device.kind} size={36} />}
      title={
        <>
          <CommitInput
            value={device.name}
            disabled={readOnly}
            ariaLabel={t("inspector.name")}
            parse={(s) => (s.trim() && s.trim().length <= 64 ? s.trim() : undefined)}
            onCommit={(name) => set((d) => void (d.name = name))}
            className="border-transparent bg-transparent px-1 font-bold hover:border-line"
          />
          <div className="px-1 text-xs text-muted">{model ? t(`catalog.${model.label}`) : device.model}</div>
        </>
      }
      actions={
        props.onOpenConsole && hasConsole(device.kind) ? (
          <IconButton title={t("console.open")} onClick={() => props.onOpenConsole!(device.id)}>
            <TerminalSquare size={18} />
          </IconButton>
        ) : undefined
      }
      onClose={() => props.onSelect(null)}
    >
      <div className="flex gap-0.5 overflow-x-auto border-b border-line px-2" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={current === x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-2 py-2.5 text-xs font-bold transition ${current === x.id ? "border-koraal text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <fieldset disabled={readOnly} className="min-w-0">
        {current === "general" && <GeneralTab {...props} set={set} />}
        {current === "interfaces" && <InterfacesTab {...props} />}
        {current === "routing" && <RoutingTab {...props} set={set} />}
        {current === "vlans" && <VlansTab {...props} set={set} />}
        {current === "acls" && <AclEditor device={device} onChange={(fn) => set(fn)} />}
      </fieldset>
      {current === "state" && <StateView device={device} sim={props.sim} />}
    </Panel>
  );
}

function GeneralTab({ device, topology, onChange, onSelect, set }: Props & { device: Device; set: (fn: (d: Device) => void) => void }) {
  const { t } = useTranslation();
  const nic = device.interfaces[0];
  const mgmt = device.interfaces.find((i) => i.type === "svi" && i.vlan === 1);
  return (
    <>
      {isHost(device) && nic && (
        <Section title={t("inspector.network")}>
          <Row label={t("inspector.ipAddress")} hint={t("inspector.ipHint")}>
            <CommitInput
              mono
              value={formatIfaceAddress(nic.ip)}
              placeholder="192.168.1.10/24"
              parse={parseIfaceAddress}
              onCommit={(ip) => onChange(updateIface(topology, device.id, nic.id, (i) => (ip ? (i.ip = ip) : delete i.ip)))}
            />
          </Row>
          <Row label={t("inspector.gateway")}>
            <CommitInput mono value={device.defaultGateway ?? ""} placeholder="192.168.1.1" parse={parseOptionalIp} onCommit={(gw) => set((d) => (gw ? (d.defaultGateway = gw) : delete d.defaultGateway))} />
          </Row>
          <Row label={t("inspector.mac")}>
            <span className="font-mono text-xs text-muted">{nic.mac}</span>
          </Row>
        </Section>
      )}
      {device.kind === "server" && (
        <Section title={t("inspector.services")}>
          <Row label={t("inspector.listenPorts")} hint={t("inspector.listenHint")}>
            <CommitInput mono value={device.listenPorts.join(", ")} placeholder="80, 443" parse={parsePortList} onCommit={(p) => set((d) => void (d.listenPorts = p))} />
          </Row>
        </Section>
      )}
      {device.kind === "switch" && mgmt && (
        <Section title={t("inspector.management")}>
          <Row label={t("inspector.ipAddress")} hint={t("inspector.mgmtHint")}>
            <CommitInput
              mono
              value={formatIfaceAddress(mgmt.ip)}
              placeholder="192.168.1.2/24"
              parse={parseIfaceAddress}
              onCommit={(ip) => onChange(updateIface(topology, device.id, mgmt.id, (i) => (ip ? (i.ip = ip) : delete i.ip)))}
            />
          </Row>
          <Row label={t("inspector.gateway")}>
            <CommitInput mono value={device.defaultGateway ?? ""} placeholder="192.168.1.1" parse={parseOptionalIp} onCommit={(gw) => set((d) => (gw ? (d.defaultGateway = gw) : delete d.defaultGateway))} />
          </Row>
        </Section>
      )}
      {(device.kind === "router" || device.kind === "l3switch") && (
        <Section title={t("inspector.routing")}>
          <Toggle checked={device.ipRouting} onChange={(v) => set((d) => void (d.ipRouting = v))} label={t("inspector.ipRouting")} description={t("inspector.ipRoutingHint")} />
        </Section>
      )}
      {isSwitch(device) && (
        <Section title={t("inspector.stp")}>
          <Toggle checked={device.stp.enabled} onChange={(v) => set((d) => void (d.stp.enabled = v))} label={t("inspector.stpEnabled")} description={t("inspector.stpHint")} />
          <Row label={t("inspector.bridgePriority")} hint={t("inspector.priorityHint")}>
            <SmallSelect value={String(device.stp.priority)} onChange={(v) => set((d) => void (d.stp.priority = Number(v)))}>
              {Array.from({ length: 16 }, (_, i) => i * 4096).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </SmallSelect>
          </Row>
        </Section>
      )}
      <Section title={t("inspector.dangerZone")}>
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 size={15} />}
          onClick={() => {
            onChange(removeDevice(topology, device.id));
            onSelect(null);
          }}
        >
          {t("inspector.deleteDevice")}
        </Button>
      </Section>
    </>
  );
}

function statusTone(sim: Simulator, i: Interface): { tone: "ok" | "bad" | "warn" | "neutral"; label: string } {
  const s = sim.net.status(i);
  if (s === "admin-down") return { tone: "bad", label: "admin-down" };
  if (s === "down") return { tone: "neutral", label: "down" };
  if (sim.stpPort(i.id)?.state === "blocking") return { tone: "warn", label: "blocking" };
  return { tone: "ok", label: "up" };
}

function InterfacesTab({ device, topology, sim, onChange }: Props & { device: Device }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [subParent, setSubParent] = useState("");
  const [subVlan, setSubVlan] = useState("");
  const [sviVlan, setSviVlan] = useState("");
  const physical = device.interfaces.filter((i) => i.type === "ethernet");
  const canRoute = device.kind === "router" || device.kind === "l3switch";
  const add = (iface: Interface) => {
    onChange(updateDevice(topology, device.id, (d) => void d.interfaces.push(iface)));
    setOpen(iface.id);
  };
  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {device.interfaces.map((i) => {
          const st = statusTone(sim, i);
          const peer = sim.net.peer(i.id);
          const expanded = open === i.id;
          return (
            <li key={i.id}>
              <button className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface" onClick={() => setOpen(expanded ? null : i.id)}>
                {expanded ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                <span className="w-24 shrink-0 font-mono text-xs font-semibold">{shortName(i.name)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {i.ip ? `${i.ip.address}/${i.ip.prefix}` : isSwitchport(i) && isSwitch(device) ? (i.mode === "trunk" ? t("inspector.trunk") : `VLAN ${i.accessVlan}`) : ""}
                  {peer && <span className="ml-1">→ {peer.device.name}</span>}
                </span>
                <Badge tone={st.tone}>{t(`inspector.status.${st.label}`)}</Badge>
              </button>
              {expanded && <InterfaceEditor device={device} iface={i} topology={topology} onChange={onChange} />}
            </li>
          );
        })}
      </ul>
      {canRoute && (
        <Section title={t("inspector.addInterface")}>
          {device.kind === "router" && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SmallSelect value={subParent} onChange={setSubParent} ariaLabel={t("inspector.parent")}>
                  <option value="">{t("inspector.parent")}</option>
                  {physical.map((p) => (
                    <option key={p.id} value={p.id}>
                      {shortName(p.name)}
                    </option>
                  ))}
                </SmallSelect>
              </div>
              <input
                value={subVlan}
                onChange={(e) => setSubVlan(e.target.value)}
                placeholder="VLAN"
                aria-label="VLAN"
                className="w-20 rounded-md border border-line bg-surface px-2 py-1.5 text-sm focus:border-koraal focus:outline-none"
              />
              <Button
                size="sm"
                icon={<Plus size={14} />}
                disabled={!subParent || !parseVlanId(subVlan) || device.interfaces.some((i) => i.parent === subParent && i.vlan === parseVlanId(subVlan))}
                onClick={() => {
                  add(createSubinterface(device, subParent, parseVlanId(subVlan)!));
                  setSubVlan("");
                }}
              >
                {t("inspector.subinterface")}
              </Button>
            </div>
          )}
          {device.kind === "l3switch" && (
            <div className="flex items-end gap-2">
              <input
                value={sviVlan}
                onChange={(e) => setSviVlan(e.target.value)}
                placeholder="VLAN"
                aria-label="VLAN"
                className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-sm focus:border-koraal focus:outline-none"
              />
              <Button
                size="sm"
                icon={<Plus size={14} />}
                disabled={!parseVlanId(sviVlan) || device.interfaces.some((i) => i.type === "svi" && i.vlan === parseVlanId(sviVlan))}
                onClick={() => {
                  add(createSvi(parseVlanId(sviVlan)!));
                  setSviVlan("");
                }}
              >
                {t("inspector.svi")}
              </Button>
            </div>
          )}
          <Button size="sm" icon={<Plus size={14} />} onClick={() => add(createLoopback(device))}>
            {t("inspector.loopback")}
          </Button>
        </Section>
      )}
    </>
  );
}

function InterfaceEditor({ device, iface, topology, onChange }: { device: Device; iface: Interface; topology: Topology; onChange: (t: Topology) => void }) {
  const { t } = useTranslation();
  const set = (fn: (i: Interface) => void) => onChange(updateIface(topology, device.id, iface.id, fn));
  const switchport = isSwitch(device) && iface.type === "ethernet";
  const l3 = !isSwitchport(iface) || !isSwitch(device);
  const vlans = [{ id: 1, name: "default" }, ...device.vlans.filter((v) => v.id !== 1)];
  return (
    <div className="space-y-2.5 bg-surface/60 px-4 pb-4 pt-2">
      <Toggle checked={iface.enabled} onChange={(v) => set((i) => void (i.enabled = v))} label={t("inspector.enabled")} description={t("inspector.enabledHint")} />
      <Row label={t("inspector.description")}>
        <CommitInput value={iface.description} parse={(s) => (s.length <= 200 ? s : undefined)} onCommit={(v) => set((i) => void (i.description = v))} />
      </Row>
      {switchport && (
        <Row label={t("inspector.mode")}>
          <SmallSelect value={iface.mode} onChange={(v) => set((i) => void (i.mode = v as Interface["mode"]))}>
            <option value="access">{t("inspector.access")}</option>
            <option value="trunk">{t("inspector.trunk")}</option>
            {device.kind === "l3switch" && <option value="routed">{t("inspector.routed")}</option>}
          </SmallSelect>
        </Row>
      )}
      {switchport && iface.mode === "access" && (
        <Row label={t("inspector.accessVlan")}>
          <SmallSelect value={String(iface.accessVlan)} onChange={(v) => set((i) => void (i.accessVlan = Number(v)))}>
            {vlans.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} {v.name}
              </option>
            ))}
            {!vlans.some((v) => v.id === iface.accessVlan) && <option value={iface.accessVlan}>{iface.accessVlan} ({t("inspector.missing")})</option>}
          </SmallSelect>
        </Row>
      )}
      {switchport && iface.mode === "trunk" && (
        <>
          <Row label={t("inspector.nativeVlan")}>
            <CommitInput mono value={String(iface.nativeVlan)} parse={parseVlanId} onCommit={(v) => set((i) => void (i.nativeVlan = v))} />
          </Row>
          <Row label={t("inspector.allowedVlans")} hint={t("inspector.allowedHint")}>
            <CommitInput mono value={iface.allowedVlans} parse={parseVlanListInput} onCommit={(v) => set((i) => void (i.allowedVlans = v))} />
          </Row>
        </>
      )}
      {iface.type === "subinterface" && (
        <Row label={t("inspector.dot1q")}>
          <CommitInput mono value={String(iface.vlan ?? "")} parse={parseVlanId} onCommit={(v) => set((i) => void (i.vlan = v))} />
        </Row>
      )}
      {l3 && (
        <Row label={t("inspector.ipAddress")} hint={t("inspector.ipHint")}>
          <CommitInput mono value={formatIfaceAddress(iface.ip)} placeholder="10.0.0.1/24" parse={parseIfaceAddress} onCommit={(ip) => set((i) => (ip ? (i.ip = ip) : delete i.ip))} />
        </Row>
      )}
      {l3 && device.acls.length > 0 && (
        <>
          <Row label={t("inspector.aclIn")}>
            <SmallSelect value={iface.aclIn ?? ""} onChange={(v) => set((i) => (v ? (i.aclIn = v) : delete i.aclIn))}>
              <option value="">—</option>
              {device.acls.map((a) => (
                <option key={a.name}>{a.name}</option>
              ))}
            </SmallSelect>
          </Row>
          <Row label={t("inspector.aclOut")}>
            <SmallSelect value={iface.aclOut ?? ""} onChange={(v) => set((i) => (v ? (i.aclOut = v) : delete i.aclOut))}>
              <option value="">—</option>
              {device.acls.map((a) => (
                <option key={a.name}>{a.name}</option>
              ))}
            </SmallSelect>
          </Row>
        </>
      )}
      <Row label={t("inspector.mac")}>
        <span className="font-mono text-xs text-muted">{iface.mac}</span>
      </Row>
      {iface.type !== "ethernet" && !(iface.type === "svi" && iface.vlan === 1 && device.kind === "switch") && (
        <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => onChange(removeIface(topology, device.id, iface.id))}>
          {t("inspector.removeInterface")}
        </Button>
      )}
    </div>
  );
}

function RoutingTab({ device, topology, sim, onChange, set }: Props & { device: Device; set: (fn: (d: Device) => void) => void }) {
  const { t } = useTranslation();
  const [dest, setDest] = useState("");
  const [via, setVia] = useState("");
  const [iface, setIface] = useState("");
  const [ad, setAd] = useState("1");
  const net = parseNetwork(dest);
  const hop = parseOptionalIp(via);
  const distance = Number(ad);
  const valid = net && hop !== undefined && (hop || iface) && Number.isInteger(distance) && distance >= 1 && distance <= 255;
  const installed = new Set(sim.routingTable(device.id).filter((r) => r.protocol === "static").map((r) => `${r.network}/${r.prefix}`));
  const l3 = sim.net.l3Interfaces(device);
  return (
    <Section title={t("inspector.staticRoutes")}>
      {device.staticRoutes.length === 0 && <p className="text-xs text-muted">{t("inspector.noRoutes")}</p>}
      <ul className="space-y-1.5">
        {device.staticRoutes.map((r) => {
          const exit = device.interfaces.find((i) => i.id === r.iface);
          const key = `${parseIp(r.network)}/${r.prefix}`;
          return (
            <li key={r.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
              <span className="min-w-0 flex-1 font-mono text-xs">
                {r.network}/{r.prefix} → {r.nextHop ?? ""}
                {exit ? ` ${shortName(exit.name)}` : ""}
                {r.distance !== 1 && <span className="text-muted"> [{r.distance}]</span>}
              </span>
              {!installed.has(key) && <Badge tone="warn">{t("inspector.inactive")}</Badge>}
              <IconButton title={t("common.delete")} danger onClick={() => set((d) => void (d.staticRoutes = d.staticRoutes.filter((x) => x.id !== r.id)))}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 rounded-md border border-dashed border-line p-3">
        <Row label={t("inspector.destination")}>
          <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="10.2.0.0/24" className={inputCls(dest !== "" && !net)} />
        </Row>
        <Row label={t("inspector.nextHop")}>
          <input value={via} onChange={(e) => setVia(e.target.value)} placeholder="172.16.0.2" className={inputCls(hop === undefined)} />
        </Row>
        <Row label={t("inspector.exitInterface")}>
          <SmallSelect value={iface} onChange={setIface}>
            <option value="">—</option>
            {l3.map((i) => (
              <option key={i.id} value={i.id}>
                {shortName(i.name)}
              </option>
            ))}
          </SmallSelect>
        </Row>
        <Row label={t("inspector.distance")}>
          <input value={ad} onChange={(e) => setAd(e.target.value)} className={inputCls(!(distance >= 1 && distance <= 255))} />
        </Row>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus size={14} />}
          disabled={!valid}
          onClick={() => {
            onChange(
              edit(topology, (draft) => {
                const d = findDevice(draft, device.id)!;
                d.staticRoutes.push({ id: newId("r"), network: net!.network, prefix: net!.prefix, nextHop: hop || undefined, iface: iface || undefined, distance });
              }),
            );
            setDest("");
            setVia("");
            setIface("");
            setAd("1");
          }}
        >
          {t("inspector.addRoute")}
        </Button>
      </div>
    </Section>
  );
}

const inputCls = (bad: boolean) =>
  `w-full rounded-md border bg-surface px-2.5 py-1.5 font-mono text-xs focus:outline-none ${bad ? "border-bad" : "border-line focus:border-koraal"}`;

function VlansTab({ device, sim, set }: Props & { device: Device; set: (fn: (d: Device) => void) => void }) {
  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const vid = parseVlanId(id);
  const vlans = [{ id: 1, name: "default" }, ...device.vlans.filter((v) => v.id !== 1)].sort((a, b) => a.id - b.id);
  return (
    <Section title={t("inspector.vlanDatabase")}>
      <ul className="space-y-1.5">
        {vlans.map((v) => {
          const ports = device.interfaces.filter((p) => isSwitchport(p) && sim.net.carriesVlan(device, p, v.id) && p.mode === "access");
          return (
            <li key={v.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
              <span className="w-12 font-mono text-xs font-bold">{v.id}</span>
              <div className="min-w-0 flex-1">
                {v.id === 1 ? (
                  <span className="text-sm">{v.name}</span>
                ) : (
                  <CommitInput
                    value={v.name}
                    parse={(s) => (s.trim() && s.length <= 32 ? s.trim() : undefined)}
                    onCommit={(n) => set((d) => void (d.vlans.find((x) => x.id === v.id)!.name = n))}
                    className="py-1"
                  />
                )}
                <span className="block truncate text-[11px] text-muted">{ports.length ? ports.map((p) => shortName(p.name)).join(", ") : t("inspector.noPorts")}</span>
              </div>
              {v.id !== 1 && (
                <IconButton title={t("common.delete")} danger onClick={() => set((d) => void (d.vlans = d.vlans.filter((x) => x.id !== v.id)))}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="ID" aria-label="VLAN ID" className={`${inputCls(id !== "" && !vid)} w-20`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("inspector.vlanName")} className={inputCls(false)} />
        <Button
          size="sm"
          icon={<Plus size={14} />}
          disabled={!vid || vlans.some((v) => v.id === vid)}
          onClick={() => {
            set((d) => void d.vlans.push({ id: vid!, name: name.trim() || `VLAN${String(vid).padStart(4, "0")}` }));
            setId("");
            setName("");
          }}
        >
          {t("inspector.add")}
        </Button>
      </div>
    </Section>
  );
}

function LinkPanel({ topology, sim, linkId, onChange, onSelect, readOnly }: Props & { linkId: string }) {
  const { t } = useTranslation();
  const link = topology.links.find((l) => l.id === linkId)!;
  const ends = [link.a, link.b].map((e) => {
    const d = findDevice(topology, e.device);
    const i = d?.interfaces.find((x) => x.id === e.iface);
    return { d, i };
  });
  return (
    <fieldset disabled={readOnly}>
      <Section title={t("editor.endpoints")}>
        {ends.map(({ d, i }, n) =>
          d && i ? (
            <button key={n} className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-muted" onClick={() => onSelect({ type: "device", id: d.id })}>
              <DeviceIcon kind={d.kind} size={28} />
              <span className="flex-1">
                <span className="block text-sm font-semibold">{d.name}</span>
                <span className="block font-mono text-xs text-muted">{i.name}</span>
              </span>
              <Badge tone={statusTone(sim, i).tone}>{t(`inspector.status.${statusTone(sim, i).label}`)}</Badge>
            </button>
          ) : null,
        )}
      </Section>
      <Section title={t("editor.medium")}>
        <SmallSelect value={link.medium} onChange={(v) => onChange(edit(topology, (draft) => void (draft.links.find((l) => l.id === linkId)!.medium = v as "copper" | "fiber")))}>
          <option value="copper">{t("editor.copper")}</option>
          <option value="fiber">{t("editor.fiber")}</option>
        </SmallSelect>
      </Section>
      <Section title={t("inspector.dangerZone")}>
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 size={15} />}
          onClick={() => {
            onChange(removeLink(topology, linkId));
            onSelect(null);
          }}
        >
          {t("editor.deleteCable")}
        </Button>
      </Section>
    </fieldset>
  );
}
