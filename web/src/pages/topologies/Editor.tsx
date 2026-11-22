import { AlertTriangle, ArrowLeft, Cable, Check, Download, Loader2, Maximize, MousePointer2, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { diagnose, Simulator, type Endpoint, type Finding, type OperationRun, type Topology } from "@netsim/engine";
import { api } from "../../api";
import { Alert, Spinner } from "../../components/ui";
import { useErrorText } from "../../hooks";
import { Canvas, type CanvasHandle, type Selection, type Tool } from "../../editor/Canvas";
import { ConsoleWindow } from "../../editor/Console";
import { CommitInput } from "../../editor/fields";
import { useTopologyHistory } from "../../editor/history";
import { Inspector } from "../../editor/Inspector";
import { LessonPanel } from "../../editor/LessonPanel";
import { addDevice, addLink, logicKey, removeDevice, removeLink } from "../../editor/ops";
import { Palette } from "../../editor/Palette";
import { usePlaybackInstance } from "../../editor/playback";
import { SimPanel } from "../../editor/SimPanel";

type Loaded = { id: number; name: string; description: string; data: Topology };

export default function TopologyEditor() {
  const { id } = useParams();
  const errorText = useErrorText();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    setLoaded(null);
    api<Loaded>(`/api/topologies/${id}`).then(setLoaded, setError);
  }, [id]);
  if (error) return <div className="p-6"><Alert tone="bad">{errorText(error)}</Alert></div>;
  if (!loaded)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  return <EditorView key={loaded.id} initial={loaded} />;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

function EditorView({ initial }: { initial: Loaded }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const history = useTopologyHistory(initial.data);
  const { topology, version } = history;
  const [name, setName] = useState(initial.name);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [showDiag, setShowDiag] = useState(false);
  const [, setTick] = useState(0);
  const canvas = useRef<CanvasHandle>(null);
  const playback = usePlaybackInstance();
  const [consoles, setConsoles] = useState<string[]>([]);
  const [activeConsole, setActiveConsole] = useState<string | null>(null);

  // The simulator only depends on configuration, not on where devices are drawn.
  const key = logicKey(topology);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sim = useMemo(() => new Simulator(topology), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const findings = useMemo(() => diagnose(topology), [key]);
  const problemDevices = useMemo(() => new Set(findings.filter((f) => f.severity === "error" && f.device).map((f) => f.device!)), [findings]);
  useEffect(() => playback.clear(), [sim, playback]);

  // Autosave shortly after each change.
  const latest = useRef(topology);
  latest.current = topology;
  useEffect(() => {
    if (version === 0) return;
    setSave("dirty");
    const timer = setTimeout(async () => {
      setSave("saving");
      try {
        await api(`/api/topologies/${initial.id}`, { method: "PUT", body: { data: latest.current } });
        setSave("saved");
        setSaveError("");
      } catch (err) {
        setSave("error");
        setSaveError(errorText(err));
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [version, initial.id, errorText]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    history.commit(selection.type === "device" ? removeDevice(topology, selection.id) : removeLink(topology, selection.id));
    setSelection(null);
  }, [selection, topology, history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") deleteSelection();
      else if (!mod && e.key.toLowerCase() === "c") setTool("cable");
      else if (!mod && e.key.toLowerCase() === "v") setTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, deleteSelection]);

  const add = (model: string, x?: number, y?: number) => {
    const n = topology.devices.length;
    const r = addDevice(topology, model, x ?? 200 + (n % 6) * 120, y ?? 160 + Math.floor(n / 6) * 140);
    history.commit(r.topology);
    setSelection({ type: "device", id: r.id });
  };

  const onLink = (a: Endpoint, b: Endpoint) => history.commit(addLink(topology, a, b));

  const onRun = (run: OperationRun) => {
    playback.start(run);
    setTick((x) => x + 1);
  };

  const openConsole = (deviceId: string) => {
    const d = topology.devices.find((x) => x.id === deviceId);
    if (!d) return;
    setConsoles((c) => (c.includes(deviceId) ? c : [...c, deviceId]));
    setActiveConsole(deviceId);
  };
  const closeConsole = (deviceId: string) => {
    setConsoles((c) => {
      const next = c.filter((x) => x !== deviceId);
      setActiveConsole((a) => (a === deviceId ? (next.at(-1) ?? null) : a));
      return next;
    });
  };
  // Close consoles of devices that were deleted (or undone).
  const openConsoles = consoles.filter((id) => topology.devices.some((d) => d.id === id));
  const active = activeConsole && openConsoles.includes(activeConsole) ? activeConsole : (openConsoles.at(-1) ?? null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ name, description: initial.description, topology }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w.-]+/g, "_") || "topology"}.netsim.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const errors = findings.filter((f) => f.severity === "error").length;
  // Hints (severity info) are listed but not counted as issues.
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const defaultSource = selection?.type === "device" ? selection.id : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2">
        <Link to="/topologies" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink" title={t("editor.back")}>
          <ArrowLeft size={18} />
        </Link>
        <div className="w-56">
          <CommitInput
            value={name}
            ariaLabel={t("topologies.name")}
            parse={(s) => (s.trim() && s.trim().length <= 120 ? s.trim() : undefined)}
            onCommit={(v) => {
              setName(v);
              void api(`/api/topologies/${initial.id}`, { method: "PUT", body: { name: v } }).catch((err) => setSaveError(errorText(err)));
            }}
            className="border-transparent bg-transparent font-bold hover:border-line"
          />
        </div>
        <SaveBadge state={save} error={saveError} />
        <Divider />
        <ToolButton title={t("editor.undo")} onClick={history.undo} disabled={!history.canUndo}>
          <Undo2 size={17} />
        </ToolButton>
        <ToolButton title={t("editor.redo")} onClick={history.redo} disabled={!history.canRedo}>
          <Redo2 size={17} />
        </ToolButton>
        <Divider />
        <ToolButton title={t("editor.select")} active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2 size={17} />
        </ToolButton>
        <ToolButton title={t("editor.cableTool")} active={tool === "cable"} onClick={() => setTool(tool === "cable" ? "select" : "cable")}>
          <Cable size={17} />
          <span className="hidden text-xs font-semibold sm:inline">{t("editor.cableTool")}</span>
        </ToolButton>
        <Divider />
        <ToolButton title={t("editor.zoomIn")} onClick={() => canvas.current?.zoom(1.2)}>
          <ZoomIn size={17} />
        </ToolButton>
        <ToolButton title={t("editor.zoomOut")} onClick={() => canvas.current?.zoom(1 / 1.2)}>
          <ZoomOut size={17} />
        </ToolButton>
        <ToolButton title={t("editor.fit")} onClick={() => canvas.current?.fit()}>
          <Maximize size={17} />
        </ToolButton>
        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={() => setShowDiag((s) => !s)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${errors ? "bg-bad/10 text-bad" : warnings ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}
          >
            {errors || warnings ? <AlertTriangle size={15} /> : <Check size={15} />}
            {errors || warnings ? t("editor.issues", { count: errors + warnings }) : t("editor.noIssues")}
          </button>
          {showDiag && <DiagnosticsList findings={findings} onPick={(f) => f.device && setSelection({ type: "device", id: f.device })} onClose={() => setShowDiag(false)} />}
        </div>
        <ToolButton title={t("editor.export")} onClick={exportJson}>
          <Download size={17} />
        </ToolButton>
      </div>
      <LessonPanel topologyId={initial.id} topology={topology} />
      <div className="relative flex min-h-0 flex-1">
        <Palette onAdd={(m) => add(m)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Canvas
              handle={canvas}
              topology={topology}
              sim={sim}
              selection={selection}
              tool={tool}
              playback={playback}
              problemDevices={problemDevices}
              onSelect={setSelection}
              onPreview={history.preview}
              onCommitMove={history.commitFrom}
              onAddDevice={add}
              onCreateLink={onLink}
              onCancelTool={() => setTool("select")}
              onOpenDevice={openConsole}
            />
            {topology.devices.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="max-w-sm rounded-lg border border-dashed border-line bg-raised/80 px-6 py-5 text-center backdrop-blur">
                  <p className="font-bold">{t("editor.emptyTitle")}</p>
                  <p className="mt-1 text-sm text-muted">{t("editor.emptyText")}</p>
                </div>
              </div>
            )}
            <ConsoleWindow
              topology={topology}
              sim={sim}
              open={openConsoles}
              active={active}
              onActivate={setActiveConsole}
              onClose={closeConsole}
              onChange={history.commit}
              onRun={onRun}
            />
          </div>
          <SimPanel topology={topology} sim={sim} playback={playback} defaultSource={defaultSource} onRun={onRun} onReset={() => { sim.reset(); playback.clear(); setTick((x) => x + 1); }} />
        </div>
        <Inspector topology={topology} sim={sim} selection={selection} onChange={history.commit} onSelect={setSelection} onOpenConsole={openConsole} />
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-line" />;
}

function ToolButton({ title, onClick, disabled, active, children }: { title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition disabled:opacity-35 ${active ? "bg-koraal text-nacht" : "text-muted hover:bg-surface hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function SaveBadge({ state, error }: { state: SaveState; error: string }) {
  const { t } = useTranslation();
  if (state === "saving" || state === "dirty")
    return (
      <span className="flex items-center gap-1 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" />
        {t("editor.saving")}
      </span>
    );
  if (state === "error")
    return (
      <span className="text-xs font-semibold text-bad" title={error}>
        {t("editor.saveFailed")}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      <Check size={13} className="text-ok" />
      {t("editor.saved")}
    </span>
  );
}

function DiagnosticsList({ findings, onPick, onClose }: { findings: Finding[]; onPick: (f: Finding) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-md border border-line bg-raised shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-bold">{t("editor.diagnostics")}</span>
        <button className="text-xs text-muted hover:text-ink" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      {findings.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{t("editor.noIssuesText")}</p>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto">
          {findings.map((f, i) => (
            <li key={i}>
              <button className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-surface" onClick={() => onPick(f)}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${f.severity === "error" ? "bg-bad" : f.severity === "warning" ? "bg-warn" : "bg-lucht"}`} />
                <span className="text-sm">{t(`diag.${f.code}`, f.params)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
