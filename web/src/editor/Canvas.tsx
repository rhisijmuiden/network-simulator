import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { isHost, shortName, type Device, type Endpoint, type Simulator, type Topology } from "@netsim/engine";
import { DeviceTile, PACKET_COLORS, TILE } from "./glyphs";
import { freePorts } from "./ops";
import { MARK_TIME, usePlaybackState, type Playback } from "./playback";

export type Selection = { type: "device" | "link"; id: string } | null;
export type Tool = "select" | "cable";

type View = { x: number; y: number; k: number };

export type CanvasHandle = { fit: () => void; zoom: (factor: number) => void };

type Props = {
  topology: Topology;
  sim: Simulator;
  selection: Selection;
  tool: Tool;
  playback: Playback;
  problemDevices: Set<string>;
  readOnly?: boolean;
  onSelect: (s: Selection) => void;
  onPreview: (t: Topology) => void;
  onCommitMove: (base: Topology, next: Topology) => void;
  onAddDevice: (model: string, x: number, y: number) => void;
  onCreateLink: (a: Endpoint, b: Endpoint) => void;
  onCancelTool: () => void;
  /** Double-click on a device: open its console. */
  onOpenDevice?: (id: string) => void;
  handle?: Ref<CanvasHandle>;
};

const center = (d: Device) => ({ x: d.x, y: d.y });

function statusColor(sim: Simulator, ifaceId: string): string {
  const ref = sim.net.ifaces.get(ifaceId);
  if (!ref) return "var(--status-offline)";
  const s = sim.net.status(ref.iface);
  if (s !== "up") return "var(--status-offline)";
  if (sim.stpPort(ifaceId)?.state === "blocking") return "var(--status-warning)";
  return "var(--status-online)";
}

/** Point at `dist` from `a` towards `b`. */
function along(a: { x: number; y: number }, b: { x: number; y: number }, dist: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, len / 2);
  return { x: a.x + (dx / len) * d, y: a.y + (dy / len) * d };
}

export function Canvas(props: Props) {
  const { topology, sim, selection, tool, playback, readOnly } = props;
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [cableStart, setCableStart] = useState<Endpoint | null>(null);
  const [picker, setPicker] = useState<{ device: string; sx: number; sy: number } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<
    | { kind: "pan"; sx: number; sy: number; view: View; moved: boolean }
    | { kind: "device"; id: string; sx: number; sy: number; base: Topology; ox: number; oy: number; moved: boolean }
    | null
  >(null);
  const devices = useMemo(() => new Map(topology.devices.map((d) => [d.id, d])), [topology.devices]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
    },
    [view],
  );

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (!topology.devices.length) return setView({ x: r.width / 2 - 400, y: r.height / 2 - 250, k: 1 });
    const xs = topology.devices.map((d) => d.x);
    const ys = topology.devices.map((d) => d.y);
    const pad = 110;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const k = Math.max(0.3, Math.min(1.4, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    setView({ k, x: r.width / 2 - ((minX + maxX) / 2) * k, y: r.height / 2 - ((minY + maxY) / 2) * k });
  }, [topology.devices]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const r = svgRef.current!.getBoundingClientRect();
      const px = cx ?? r.width / 2;
      const py = cy ?? r.height / 2;
      const k = Math.max(0.25, Math.min(3, v.k * factor));
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });
  }, []);

  useImperativeHandle(props.handle, () => ({ fit, zoom: (f) => zoomAt(f) }), [fit, zoomAt]);

  // Fit once when the editor opens.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && svgRef.current) {
      fitted.current = true;
      fit();
    }
  }, [fit]);

  useEffect(() => {
    if (tool !== "cable") {
      setCableStart(null);
      setPicker(null);
    }
  }, [tool]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const lastDown = useRef<{ id: string; at: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    setPicker(null);
    const target = (e.target as Element).closest("[data-device]");
    const id = target?.getAttribute("data-device");
    if (id && tool === "cable" && !readOnly) {
      const r = svgRef.current!.getBoundingClientRect();
      // Keep the port list inside the canvas.
      const sx = Math.min(e.clientX - r.left + 12, r.width - 236);
      const sy = Math.min(e.clientY - r.top - 20, r.height - 310);
      setPicker({ device: id, sx: Math.max(8, sx), sy: Math.max(8, sy) });
      return;
    }
    const linkId = (e.target as Element).closest("[data-link]")?.getAttribute("data-link");
    if (linkId && tool === "select") {
      props.onSelect({ type: "link", id: linkId });
      return;
    }
    // Double-click on a device opens its console (detected here: pointer capture retargets dblclick).
    if (id && tool === "select") {
      const last = lastDown.current;
      lastDown.current = { id, at: e.timeStamp };
      if (last && last.id === id && e.timeStamp - last.at < 400) {
        lastDown.current = null;
        props.onSelect({ type: "device", id });
        props.onOpenDevice?.(id);
        return;
      }
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    if (id && tool === "select") {
      const d = devices.get(id)!;
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { kind: "device", id, sx: w.x, sy: w.y, base: topology, ox: d.x, oy: d.y, moved: false };
      props.onSelect({ type: "device", id });
    } else {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, view, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (cableStart) setPointer(toWorld(e.clientX, e.clientY));
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
    } else if (!readOnly) {
      const w = toWorld(e.clientX, e.clientY);
      const nx = Math.round((d.ox + w.x - d.sx) / 10) * 10;
      const ny = Math.round((d.oy + w.y - d.sy) / 10) * 10;
      if (!d.moved && Math.abs(w.x - d.sx) + Math.abs(w.y - d.sy) < 3) return;
      d.moved = true;
      props.onPreview({ ...d.base, devices: d.base.devices.map((x) => (x.id === d.id ? { ...x, x: nx, y: ny } : x)) });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "pan" && !d.moved) props.onSelect(null);
    if (d.kind === "device" && d.moved) props.onCommitMove(d.base, topology);
  };

  const choosePort = (device: string, iface: string) => {
    setPicker(null);
    if (!cableStart) {
      setCableStart({ device, iface });
      return;
    }
    if (cableStart.device !== device) props.onCreateLink(cableStart, { device, iface });
    setCableStart(null);
    setPointer(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPicker(null);
        setCableStart(null);
        props.onCancelTool();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pickerDevice = picker ? devices.get(picker.device) : undefined;
  const startDevice = cableStart ? devices.get(cableStart.device) : undefined;

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        className={`h-full w-full touch-none select-none ${tool === "cable" ? "cursor-crosshair" : drag.current?.kind === "pan" ? "cursor-grabbing" : "cursor-default"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={(e) => {
          if (!readOnly && e.dataTransfer.types.includes("application/x-netsim-model")) e.preventDefault();
        }}
        onDrop={(e) => {
          const model = e.dataTransfer.getData("application/x-netsim-model");
          if (!model || readOnly) return;
          e.preventDefault();
          const w = toWorld(e.clientX, e.clientY);
          props.onAddDevice(model, Math.round(w.x / 10) * 10, Math.round(w.y / 10) * 10);
        }}
      >
        <defs>
          <pattern id="grid" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill="var(--line)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <Links topology={topology} devices={devices} sim={sim} selection={selection} showLabels={view.k > 0.6} />
          {startDevice && pointer && (
            <line x1={startDevice.x} y1={startDevice.y} x2={pointer.x} y2={pointer.y} stroke="var(--koraal)" strokeWidth={2} strokeDasharray="6 5" />
          )}
          <Devices topology={topology} running={sim.topology} selection={selection} problems={props.problemDevices} cableFrom={cableStart?.device} />
          <PacketLayer playback={playback} devices={devices} sim={sim} />
        </g>
      </svg>
      {tool === "cable" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-nacht px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
          {cableStart ? t("editor.cableSecond") : t("editor.cableFirst")}
        </div>
      )}
      {picker && pickerDevice && (
        <PortPicker
          device={pickerDevice}
          topology={topology}
          x={picker.sx}
          y={picker.sy}
          onPick={(iface) => choosePort(pickerDevice.id, iface)}
          onClose={() => setPicker(null)}
          disabled={cableStart?.device === pickerDevice.id}
        />
      )}
    </div>
  );
}

const Links = memo(function Links({
  topology,
  devices,
  sim,
  selection,
  showLabels,
}: {
  topology: Topology;
  devices: Map<string, Device>;
  sim: Simulator;
  selection: Selection;
  showLabels: boolean;
}) {
  return (
    <g>
      {topology.links.map((l) => {
        const a = devices.get(l.a.device);
        const b = devices.get(l.b.device);
        if (!a || !b) return null;
        const ia = a.interfaces.find((i) => i.id === l.a.iface);
        const ib = b.interfaces.find((i) => i.id === l.b.iface);
        const selected = selection?.type === "link" && selection.id === l.id;
        const pa = along(center(a), center(b), TILE * 0.5 + 12);
        const pb = along(center(b), center(a), TILE * 0.5 + 12);
        const la = along(center(a), center(b), TILE * 0.5 + 34);
        const lb = along(center(b), center(a), TILE * 0.5 + 34);
        return (
          <g key={l.id} data-link={l.id} className="cursor-pointer">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
            {selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--koraal)" strokeWidth={6} strokeOpacity={0.35} strokeLinecap="round" />}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={l.medium === "fiber" ? "var(--status-warning)" : "var(--ink-muted)"}
              strokeOpacity={0.7}
              strokeWidth={2}
              strokeDasharray={l.medium === "fiber" ? "8 4" : undefined}
            />
            <circle cx={pa.x} cy={pa.y} r={4.5} fill={statusColor(sim, l.a.iface)} stroke="var(--surface)" strokeWidth={1.5} />
            <circle cx={pb.x} cy={pb.y} r={4.5} fill={statusColor(sim, l.b.iface)} stroke="var(--surface)" strokeWidth={1.5} />
            {showLabels && ia && <PortLabel x={la.x} y={la.y} text={shortName(ia.name)} />}
            {showLabels && ib && <PortLabel x={lb.x} y={lb.y} text={shortName(ib.name)} />}
          </g>
        );
      })}
    </g>
  );
});

function PortLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 5.6 + 8;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect x={-w / 2} y={-8} width={w} height={16} rx={4} fill="var(--surface-raised)" stroke="var(--line)" />
      <text textAnchor="middle" dy={3.5} fontSize={9.5} fontWeight={600} fill="var(--ink-muted)">
        {text}
      </text>
    </g>
  );
}

const Devices = memo(function Devices({
  topology,
  running,
  selection,
  problems,
  cableFrom,
}: {
  topology: Topology;
  /** The simulated topology, with DHCP leases: used for host address labels. */
  running: Topology;
  selection: Selection;
  problems: Set<string>;
  cableFrom?: string;
}) {
  return (
    <g>
      {topology.devices.map((d) => {
        const ip = isHost(d) ? (running.devices.find((x) => x.id === d.id) ?? d).interfaces.find((i) => i.ip)?.ip : undefined;
        return (
          <g key={d.id} data-device={d.id} transform={`translate(${d.x},${d.y})`} className="cursor-pointer">
            <DeviceTile kind={d.kind} selected={(selection?.type === "device" && selection.id === d.id) || cableFrom === d.id} />
            {problems.has(d.id) && (
              <g transform={`translate(${TILE / 2 - 4},${-TILE / 2 + 4})`}>
                <circle r={8} fill="var(--status-offline)" stroke="var(--surface)" strokeWidth={2} />
                <text textAnchor="middle" dy={3.5} fontSize={11} fontWeight={800} fill="#fff">
                  !
                </text>
              </g>
            )}
            <text y={TILE / 2 + 17} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">
              {d.name}
            </text>
            {ip && (
              <text y={TILE / 2 + 31} textAnchor="middle" fontSize={10.5} fill="var(--ink-muted)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
                {ip.address}/{ip.prefix}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

function PacketLayer({ playback, devices, sim }: { playback: Playback; devices: Map<string, Device>; sim: Simulator }) {
  const { now, run } = usePlaybackState(playback);
  if (!run) return null;
  const items: React.ReactNode[] = [];
  for (const e of run.events) {
    if (e.t > now) break;
    if (e.type === "tx" && now < e.t + 1) {
      const a = devices.get(e.from.device);
      const b = devices.get(e.to.device);
      if (!a || !b) continue;
      const p = now - e.t;
      const x = a.x + (b.x - a.x) * p;
      const y = a.y + (b.y - a.y) * p;
      const color = PACKET_COLORS[e.frame.kind];
      items.push(
        <g key={`p${e.frame.id}`} transform={`translate(${x},${y})`}>
          <circle r={11} fill={color} opacity={0.22} />
          <circle r={6.5} fill={color} stroke="var(--surface-raised)" strokeWidth={2} />
          {e.frame.vlan !== undefined && (
            <text y={-12} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--ink-muted)">
              {e.frame.vlan}
            </text>
          )}
        </g>,
      );
    } else if (e.type === "drop" && now < e.t + MARK_TIME) {
      const d = devices.get(e.device);
      if (!d) continue;
      let pos = { x: d.x + TILE / 2, y: d.y - TILE / 2 };
      const peer = e.iface ? sim.net.peer(e.iface) : undefined;
      if (peer) pos = along(center(d), center(peer.device), TILE / 2 + 6);
      const soft = e.reason === "stp-blocking" || e.reason === "ttl-expired";
      const color = e.reason === "stp-blocking" ? "var(--ink-muted)" : soft ? "var(--status-warning)" : "var(--status-offline)";
      const fade = 1 - (now - e.t) / MARK_TIME;
      items.push(
        <g key={`d${items.length}`} transform={`translate(${pos.x},${pos.y}) scale(${0.8 + 0.4 * (1 - fade)})`} opacity={Math.max(0, fade * 1.4)}>
          <circle r={10} fill={color} />
          <path d="M-4 -4 4 4M4 -4-4 4" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        </g>,
      );
    } else if (e.type === "deliver" && now < e.t + MARK_TIME && e.frame.kind !== "arp-request" && e.frame.kind !== "arp-reply") {
      const d = devices.get(e.device);
      if (!d) continue;
      const p = (now - e.t) / MARK_TIME;
      items.push(
        <circle key={`v${items.length}`} cx={d.x} cy={d.y} r={TILE / 2 + 6 + p * 18} fill="none" stroke={PACKET_COLORS[e.frame.kind]} strokeWidth={3} opacity={1 - p} />,
      );
    }
  }
  // Outcome badge on the source once the replay has finished.
  if (now >= playback.end - 0.01) {
    const src = devices.get(run.result.source);
    const r = run.result;
    const ok = r.op === "ping" ? r.received === r.sent : r.op === "traceroute" ? r.reached : r.status === "open";
    const partial = r.op === "ping" && r.received > 0 && !ok;
    if (src) {
      const color = ok ? "var(--status-online)" : partial ? "var(--status-warning)" : "var(--status-offline)";
      items.push(
        <g key="result" transform={`translate(${src.x - TILE / 2 + 2},${src.y - TILE / 2 + 2})`}>
          <circle r={12} fill={color} stroke="var(--surface)" strokeWidth={2.5} />
          <path d={ok ? "M-5 0-1.5 3.5 5-3.5" : "M-4 -4 4 4M4 -4-4 4"} stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>,
      );
    }
  }
  return <g pointerEvents="none">{items}</g>;
}

function PortPicker({
  device,
  topology,
  x,
  y,
  onPick,
  onClose,
  disabled,
}: {
  device: Device;
  topology: Topology;
  x: number;
  y: number;
  onPick: (iface: string) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const ports = freePorts(topology, device);
  return (
    <div
      className="absolute z-20 w-56 overflow-hidden rounded-md border border-line bg-raised shadow-2xl"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-sm font-bold">{device.name}</span>
        <button className="text-xs text-muted hover:text-ink" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
      {disabled ? (
        <p className="px-3 py-3 text-xs text-muted">{t("editor.sameDevice")}</p>
      ) : ports.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted">{t("editor.noFreePorts")}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {ports.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-surface" onClick={() => onPick(p.id)}>
                <span className="font-mono text-xs">{shortName(p.name)}</span>
                <span className="text-[11px] text-muted">{p.speed >= 1000 ? `${p.speed / 1000} Gb/s` : `${p.speed} Mb/s`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
