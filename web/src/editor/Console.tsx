import { Maximize2, Minimize2, TerminalSquare, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IosSession, type OperationRun, type Simulator, type Topology } from "@netsim/engine";

/** Console state for one device; kept for as long as the editor is open. */
type Term = { session: IosSession; lines: string[]; input: string; histPos: number | null; draft: string };

const MAX_LINES = 2000;

export type ConsoleProps = {
  topology: Topology;
  sim: Simulator;
  open: string[];
  active: string | null;
  readOnly?: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onChange: (t: Topology) => void;
  onRun: (run: OperationRun) => void;
};

/**
 * Floating console window with one tab per device, in the style of a terminal
 * connected to the console port. The IOS-style command interpreter lives in the engine.
 */
export function ConsoleWindow(props: ConsoleProps) {
  const { topology, sim, open, active, readOnly } = props;
  const { t } = useTranslation();
  const terms = useRef(new Map<string, Term>());
  const [, rerender] = useState(0);
  const [big, setBig] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const term = (id: string): Term => {
    let x = terms.current.get(id);
    if (!x) {
      const name = topology.devices.find((d) => d.id === id)?.name ?? "";
      x = { session: new IosSession(id), lines: [t("console.connected", { name }), t("console.hint"), ""], input: "", histPos: null, draft: "" };
      terms.current.set(id, x);
    }
    return x;
  };

  const cur = active ? term(active) : null;
  const device = active ? topology.devices.find((d) => d.id === active) : undefined;
  const prompt = cur ? cur.session.prompt(topology) : "";

  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  });
  useEffect(() => {
    input.current?.focus();
  }, [active]);

  if (!open.length || !cur || !device || !active) return null;

  const print = (...lines: string[]) => {
    cur.lines.push(...lines);
    if (cur.lines.length > MAX_LINES) cur.lines.splice(0, cur.lines.length - MAX_LINES);
  };
  const setInput = (v: string) => {
    cur.input = v;
    rerender((n) => n + 1);
  };

  const submit = () => {
    const line = cur.input;
    print(prompt + line);
    cur.input = "";
    cur.histPos = null;
    if (readOnly && line.trim()) {
      print(t("console.readOnly"));
    } else {
      const r = cur.session.execute(line, { topology, sim });
      print(...r.output);
      if (r.topology) props.onChange(r.topology);
      if (r.run) props.onRun(r.run);
    }
    rerender((n) => n + 1);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "?") {
      // IOS shows help immediately and keeps the line.
      e.preventDefault();
      print(prompt + cur.input + "?", ...cur.session.help(cur.input));
      rerender((n) => n + 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const c = cur.session.complete(cur.input);
      if (c) setInput(c);
    } else if (e.key === "ArrowUp" || (ctrl && e.key.toLowerCase() === "p")) {
      e.preventDefault();
      const h = cur.session.history;
      if (!h.length) return;
      if (cur.histPos === null) {
        cur.draft = cur.input;
        cur.histPos = h.length - 1;
      } else cur.histPos = Math.max(0, cur.histPos - 1);
      setInput(h[cur.histPos]!);
    } else if (e.key === "ArrowDown" || (ctrl && e.key.toLowerCase() === "n")) {
      e.preventDefault();
      const h = cur.session.history;
      if (cur.histPos === null) return;
      if (cur.histPos >= h.length - 1) {
        cur.histPos = null;
        setInput(cur.draft);
      } else {
        cur.histPos += 1;
        setInput(h[cur.histPos]!);
      }
    } else if (ctrl && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "c")) {
      // Ctrl+Z (and Ctrl+C) leave configuration mode, as on the real console. Stops the editor's undo shortcut.
      e.preventDefault();
      e.stopPropagation();
      print(prompt + cur.input + (e.key.toLowerCase() === "z" ? "^Z" : "^C"));
      cur.session.end();
      setInput("");
    } else if (ctrl && e.key.toLowerCase() === "l") {
      e.preventDefault();
      cur.lines = [];
      rerender((n) => n + 1);
    }
  };

  return (
    <section
      aria-label={t("console.title")}
      className={`absolute z-20 flex flex-col overflow-hidden rounded-lg border border-line bg-raised shadow-2xl ${
        big ? "inset-3" : "bottom-3 right-3 h-[min(420px,calc(100%-24px))] w-[min(680px,calc(100%-24px))]"
      }`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center gap-1 border-b border-line bg-surface pl-3 pr-1">
        <TerminalSquare size={15} className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" role="tablist">
          {open.map((id) => {
            const d = topology.devices.find((x) => x.id === id);
            if (!d) return null;
            return (
              <div key={id} className={`-mb-px flex items-center border-b-2 ${id === active ? "border-koraal" : "border-transparent"}`}>
                <button role="tab" aria-selected={id === active} onClick={() => props.onActivate(id)} className={`whitespace-nowrap py-2 pl-2 pr-1 text-xs font-bold ${id === active ? "text-ink" : "text-muted hover:text-ink"}`}>
                  {d.name}
                </button>
                <button aria-label={t("console.closeTab", { name: d.name })} title={t("console.closeTab", { name: d.name })} onClick={() => props.onClose(id)} className="rounded p-0.5 text-muted hover:bg-raised hover:text-ink">
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <button title={big ? t("console.restore") : t("console.maximize")} aria-label={big ? t("console.restore") : t("console.maximize")} onClick={() => setBig((b) => !b)} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink">
          {big ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button title={t("console.closeAll")} aria-label={t("console.closeAll")} onClick={() => open.forEach((id) => props.onClose(id))} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink">
          <X size={16} />
        </button>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 cursor-text overflow-y-auto bg-nacht px-3 py-2 font-mono text-[12.5px] leading-[1.45] text-white/90"
        onClick={() => {
          if (!window.getSelection()?.toString()) input.current?.focus();
        }}
        data-testid="console-output"
      >
        <pre className="whitespace-pre-wrap break-words font-mono">{cur.lines.join("\n")}</pre>
        <div className="flex">
          <span className="whitespace-pre">{prompt}</span>
          <input
            ref={input}
            value={cur.input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label={t("console.input", { name: device.name })}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[12.5px] text-white caret-koraal"
            style={{ outline: "none" }}
          />
        </div>
      </div>
    </section>
  );
}

/** Devices that have a console in this version. Hosts get their command prompt in a later step. */
export function hasConsole(kind: string): boolean {
  return kind === "router" || kind === "switch" || kind === "l3switch";
}
