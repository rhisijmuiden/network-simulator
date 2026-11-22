import { ChevronDown, ChevronUp, Eraser, FastForward, Pause, Play, RotateCcw, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { isHost, isIp, shortName, type DropReason, type OperationRun, type SimEvent, type Simulator, type Topology } from "@netsim/engine";
import { Button } from "../components/ui";
import { SmallSelect } from "./fields";
import { PACKET_COLORS } from "./glyphs";
import { allAddresses } from "./ops";
import { usePlaybackState, type Playback } from "./playback";

type Op = "ping" | "traceroute" | "tcp";

const SPEEDS = [0.5, 1, 2, 4];
const SOFT: DropReason[] = ["stp-blocking", "ttl-expired"];

type Props = {
  topology: Topology;
  sim: Simulator;
  playback: Playback;
  defaultSource?: string;
  onRun: (run: OperationRun) => void;
  onReset: () => void;
};

export function SimPanel({ topology, sim, playback, defaultSource, onRun, onReset }: Props) {
  const { t } = useTranslation();
  const state = usePlaybackState(playback);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"output" | "events">("output");
  const [op, setOp] = useState<Op>("ping");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("80");
  const [error, setError] = useState("");

  // Hosts first: they are the usual place to start a test from.
  const sources = topology.devices.filter((d) => d.interfaces.some((i) => i.ip)).sort((a, b) => Number(isHost(b)) - Number(isHost(a)));
  const src = sources.find((d) => d.id === source) ? source : sources.find((d) => d.id === defaultSource)?.id ?? sources[0]?.id ?? "";
  const addresses = useMemo(() => allAddresses(topology), [topology]);
  const run = state.run;
  const finished = run && state.now >= playback.end - 0.01;

  const start = () => {
    setError("");
    const dst = target.trim();
    if (!src) return setError(t("sim.needSource"));
    if (!isIp(dst)) return setError(t("sim.needTarget"));
    const p = Number(port);
    if (op === "tcp" && !(Number.isInteger(p) && p > 0 && p < 65536)) return setError(t("sim.needPort"));
    const r = op === "ping" ? sim.ping(src, dst) : op === "traceroute" ? sim.traceroute(src, dst) : sim.tcpConnect(src, dst, p);
    onRun(r);
    setOpen(true);
    setTab("output");
  };

  return (
    <div className="border-t border-line bg-raised">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="w-32">
            <SmallSelect value={op} onChange={(v) => setOp(v as Op)} ariaLabel={t("sim.operation")}>
              <option value="ping">{t("sim.ops.ping")}</option>
              <option value="traceroute">{t("sim.ops.traceroute")}</option>
              <option value="tcp">{t("sim.ops.tcp")}</option>
            </SmallSelect>
          </div>
          <span className="text-xs text-muted">{t("sim.from")}</span>
          <div className="w-32">
            <SmallSelect value={src} onChange={setSource} ariaLabel={t("sim.from")}>
              {sources.length === 0 && <option value="">—</option>}
              {sources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SmallSelect>
          </div>
          <span className="text-xs text-muted">{t("sim.to")}</span>
          <input
            list="netsim-addresses"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder="10.0.0.1"
            aria-label={t("sim.to")}
            className="w-36 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs focus:border-koraal focus:outline-none"
          />
          <datalist id="netsim-addresses">
            {addresses.map((a) => (
              <option key={a.ip + a.label} value={a.ip}>
                {a.label}
              </option>
            ))}
          </datalist>
          {op === "tcp" && (
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              aria-label={t("sim.port")}
              className="w-16 rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs focus:border-koraal focus:outline-none"
            />
          )}
          <Button variant="primary" size="sm" icon={<Send size={14} />} onClick={start} disabled={!src}>
            {t("sim.run")}
          </Button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!run} onClick={() => (state.playing ? playback.pause() : playback.play())} title={state.playing ? t("sim.pause") : t("sim.play")}>
            {state.playing ? <Pause size={15} /> : finished ? <RotateCcw size={15} /> : <Play size={15} />}
          </Button>
          <Button variant="ghost" size="sm" disabled={!run || !!finished} onClick={() => playback.skipToEnd()} title={t("sim.skip")}>
            <FastForward size={15} />
          </Button>
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label={t("sim.speed")}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => playback.setSpeed(s)}
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${playback.speed === s ? "bg-nacht text-white dark:bg-lucht dark:text-nacht" : "text-muted hover:text-ink"}`}
              >
                {s}×
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} title={t("sim.resetHint")}>
            <Eraser size={15} />
            <span className="hidden xl:inline">{t("sim.reset")}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} title={open ? t("sim.collapse") : t("sim.expand")}>
            {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </Button>
        </div>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-bad">{error}</p>}
      {open && (
        <div className="border-t border-line">
          <div className="flex items-center gap-4 px-4 pt-2">
            {(["output", "events"] as const).map((x) => (
              <button key={x} onClick={() => setTab(x)} className={`border-b-2 pb-1.5 text-xs font-bold ${tab === x ? "border-koraal text-ink" : "border-transparent text-muted"}`}>
                {t(`sim.tabs.${x}`)}
              </button>
            ))}
            <Legend />
          </div>
          <div className="h-44 overflow-y-auto px-4 py-3">
            {!run ? (
              <p className="text-sm text-muted">{t("sim.empty")}</p>
            ) : tab === "output" ? (
              <Output run={run} finished={!!finished} sim={sim} />
            ) : (
              <EventLog events={run.events} now={state.now} sim={sim} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend() {
  const { t } = useTranslation();
  const items: [string, string][] = [
    [PACKET_COLORS["arp-request"], "ARP"],
    [PACKET_COLORS["echo-request"], t("sim.legend.request")],
    [PACKET_COLORS["echo-reply"], t("sim.legend.reply")],
    [PACKET_COLORS.unreachable, t("sim.legend.error")],
    [PACKET_COLORS.tcp, "TCP"],
    [PACKET_COLORS.esp, t("sim.legend.ipsec")],
  ];
  return (
    <div className="ml-auto hidden items-center gap-3 pb-1.5 md:flex">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1 text-[11px] text-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function useNames(sim: Simulator) {
  return {
    dev: (id?: string) => (id ? sim.net.devices.get(id)?.name ?? "?" : ""),
    iface: (id?: string) => (id ? shortName(sim.net.ifaces.get(id)?.iface.name ?? "") : ""),
  };
}

/** The first real failure of a run, in words: where and why the packet was dropped. */
function diagnosis(run: OperationRun): Extract<SimEvent, { type: "drop" }> | undefined {
  const drops = run.events.filter((e): e is Extract<SimEvent, { type: "drop" }> => e.type === "drop" && !SOFT.includes(e.reason));
  return drops.find((e) => e.frame?.kind !== "arp-request" && e.frame?.kind !== "arp-reply") ?? drops[0];
}

function Output({ run, finished, sim }: { run: OperationRun; finished: boolean; sim: Simulator }) {
  const { t } = useTranslation();
  const n = useNames(sim);
  if (!finished) return <p className="animate-pulse text-sm text-muted">{t("sim.running")}</p>;
  const r = run.result;
  const lines: string[] = [];
  let ok = false;
  if (r.op === "ping") {
    lines.push(t("sim.out.pinging", { target: r.target }));
    for (const x of r.replies) {
      if (x.status === "reply") lines.push(t("sim.out.reply", { from: x.from, time: x.time }));
      else if (x.status === "timeout") lines.push(t("sim.out.timeout"));
      else if (x.status === "ttl-expired") lines.push(t("sim.out.ttl", { from: x.from }));
      else if (x.from) lines.push(t(`sim.out.unreach.${x.code ?? "net"}`, { from: x.from }));
      else lines.push(t("sim.out.failure"));
    }
    const lost = r.sent - r.received;
    lines.push("", t("sim.out.stats", { sent: r.sent, received: r.received, lost, pct: Math.round((lost / r.sent) * 100) }));
    ok = r.received === r.sent;
  } else if (r.op === "traceroute") {
    lines.push(t("sim.out.tracing", { target: r.target }));
    for (const h of r.hops) {
      const pad = String(h.ttl).padStart(2, " ");
      if (h.status === "timeout") lines.push(`${pad}   *        ${t("sim.out.timeout")}`);
      else lines.push(`${pad}   ${h.address}${h.name ? `  (${h.name})` : ""}${h.status === "unreachable" ? `  !${t("sim.out.unreachShort")}` : ""}`);
    }
    lines.push("", r.reached ? t("sim.out.traceDone") : t("sim.out.traceFail"));
    ok = r.reached;
  } else {
    lines.push(t("sim.out.connecting", { target: r.target, port: r.port }), t(`sim.out.tcp.${r.status}`));
    ok = r.status === "open";
  }
  const why = diagnosis(run);
  const partial = r.op === "ping" && r.received > 0 && !ok;
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <pre className="overflow-x-auto rounded-md bg-nacht p-3 font-mono dark:bg-black/40 text-[12px] leading-relaxed text-white/90">{lines.join("\n")}</pre>
      <div className={`rounded-md border p-3 text-sm ${ok ? "border-ok/40 bg-ok/8" : partial ? "border-warn/40 bg-warn/8" : "border-bad/40 bg-bad/8"}`}>
        <p className="font-bold">{ok ? t("sim.verdict.ok") : partial ? t("sim.verdict.partial") : t("sim.verdict.fail")}</p>
        {why && !ok && (
          <p className="mt-1 text-xs">
            {t("sim.droppedAt", { device: n.dev(why.device), iface: n.iface(why.iface) })} {t(`sim.drop.${why.reason}`, { detail: why.detail ?? "" })}
          </p>
        )}
        {!why && !ok && <p className="mt-1 text-xs">{t("sim.noDropHint")}</p>}
        {r.op === "ping" && partial && <p className="mt-1 text-xs">{t("sim.arpHint")}</p>}
      </div>
    </div>
  );
}

function describeFrame(t: TFunction, e: Extract<SimEvent, { type: "tx" }>): string {
  const f = e.frame;
  switch (f.kind) {
    case "arp-request":
      return t("sim.frame.arpRequest", { target: f.dstIp, sender: f.srcIp });
    case "arp-reply":
      return t("sim.frame.arpReply", { ip: f.srcIp, mac: f.srcMac });
    default:
      return `${t(`sim.kinds.${f.kind}`)} ${f.srcIp} → ${f.dstIp}${f.detail ? ` (${f.detail})` : ""}${f.ttl !== undefined ? ` TTL ${f.ttl}` : ""}`;
  }
}

function EventLog({ events, now, sim }: { events: SimEvent[]; now: number; sim: Simulator }) {
  const { t } = useTranslation();
  const n = useNames(sim);
  const shown = events.filter((e) => e.t <= now).slice(-300);
  return (
    <ol className="space-y-1 font-mono text-[11.5px]">
      {shown.map((e, i) => (
        <li key={i} className="flex gap-2">
          <span className="w-10 shrink-0 text-right text-muted">{e.t.toFixed(0)}</span>
          {e.type === "tx" && (
            <>
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: PACKET_COLORS[e.frame.kind] }} />
              <span className="w-44 shrink-0 truncate">
                {n.dev(e.from.device)} {n.iface(e.from.iface)} → {n.dev(e.to.device)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">
                {describeFrame(t, e)}
                {e.frame.vlan !== undefined && ` [VLAN ${e.frame.vlan}]`}
              </span>
            </>
          )}
          {e.type === "drop" && (
            <span className={SOFT.includes(e.reason) ? "text-warn" : "text-bad"}>
              ✗ {n.dev(e.device)} {n.iface(e.iface)}: {t(`sim.drop.${e.reason}`, { detail: e.detail ?? "" })}
            </span>
          )}
          {e.type === "deliver" && (
            <span className="text-ok">
              ✓ {n.dev(e.device)}: {t(`sim.kinds.${e.frame.kind}`)} {e.frame.detail ? `(${e.frame.detail})` : ""}
            </span>
          )}
          {e.type === "storm" && <span className="font-bold text-bad">⚠ {t("sim.storm", { frames: e.frames })}</span>}
        </li>
      ))}
    </ol>
  );
}
