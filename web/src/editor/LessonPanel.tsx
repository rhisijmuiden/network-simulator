import { ChevronDown, ChevronUp, GraduationCap, Lightbulb, ListChecks, Loader2, PartyPopper, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CheckResult, LessonText, Topology } from "@netsim/engine";
import { api } from "../api";
import { useApi, useErrorText } from "../hooks";
import { GoalList, lessonPath, useLessonText, type Attempt, type Lesson } from "../lessons/common";

/** Shown above the canvas when the topology is a student's copy of a lesson: briefing, goals, checking and hints. */
export function LessonPanel({ topologyId, topology }: { topologyId: number; topology: Topology }) {
  const lesson = useApi<{ lesson: Lesson | null }>(`/api/lessons/attempt?topology=${topologyId}`);
  const l = lesson.data?.lesson;
  if (!l || !l.attempt) return null;
  return <Panel lesson={l} attempt={l.attempt} topology={topology} />;
}

function Panel({ lesson, attempt: initial, topology }: { lesson: Lesson; attempt: Attempt; topology: Topology }) {
  const { t } = useTranslation();
  const lt = useLessonText();
  const errorText = useErrorText();
  const [open, setOpen] = useState(initial.checksRun === 0);
  const [attempt, setAttempt] = useState(initial);
  const [results, setResults] = useState<CheckResult[] | undefined>(initial.results.length ? initial.results : undefined);
  const [hints, setHints] = useState<LessonText[]>(lesson.hints);
  const [busy, setBusy] = useState<"check" | "hint" | "restart" | null>(null);
  const [error, setError] = useState("");
  const [justDone, setJustDone] = useState(false);

  const check = async () => {
    setBusy("check");
    setError("");
    try {
      const r = await api<{ results: CheckResult[]; completed: boolean; attempt: Attempt }>(`/api/lessons/attempts/${attempt.id}/check`, { body: { data: topology } });
      setResults(r.results);
      setJustDone(r.completed && attempt.status !== "completed");
      setAttempt(r.attempt);
      setOpen(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const hint = async () => {
    setBusy("hint");
    try {
      const r = await api<{ hints: LessonText[] }>(`/api/lessons/attempts/${attempt.id}/hint`, { method: "POST" });
      setHints(r.hints);
      setOpen(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    if (!window.confirm(t("lessons.restartConfirm"))) return;
    setBusy("restart");
    try {
      await api(`/api/lessons/attempts/${attempt.id}/restart`, { method: "POST" });
      window.location.reload();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  const passed = results?.filter((r) => r.passed).length ?? 0;
  const left = lesson.hintCount - hints.length;

  return (
    <section aria-label={t("lessons.panel.label")} className="border-b border-line bg-raised">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <GraduationCap size={18} className="shrink-0 text-accent-text" />
        <Link to={lessonPath(lesson.key)} className="min-w-0 truncate text-sm font-bold hover:text-accent-text">
          {lt(lesson.title)}
        </Link>
        {results && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${passed === results.length ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"}`}>
            {t("lessons.panel.score", { passed, total: results.length })}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={check} disabled={!!busy} className="flex items-center gap-1.5 rounded-md bg-koraal px-3 py-1.5 text-xs font-semibold text-nacht hover:brightness-105 disabled:opacity-50">
          {busy === "check" ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />}
          {t("lessons.panel.check")}
        </button>
        <button onClick={hint} disabled={!!busy || left <= 0} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold hover:border-muted disabled:opacity-50">
          <Lightbulb size={14} />
          {left > 0 ? t("lessons.panel.hint", { count: left }) : t("lessons.panel.noHints")}
        </button>
        <button onClick={restart} disabled={!!busy} title={t("lessons.restart")} aria-label={t("lessons.restart")} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink">
          <RotateCcw size={15} />
        </button>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? t("lessons.panel.collapse") : t("lessons.panel.expand")} aria-label={open ? t("lessons.panel.collapse") : t("lessons.panel.expand")} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-bad">{error}</p>}
      {open && (
        <div className="grid max-h-[38vh] gap-4 overflow-y-auto border-t border-line px-4 py-3 md:grid-cols-[3fr_2fr]">
          <div className="space-y-3">
            {justDone && (
              <p className="flex items-center gap-2 rounded-md bg-ok/10 px-3 py-2 text-sm font-semibold text-ok">
                <PartyPopper size={17} />
                {t("lessons.panel.done")}
              </p>
            )}
            <p className="whitespace-pre-line text-sm leading-relaxed">{lt(lesson.briefing)}</p>
            {hints.length > 0 && (
              <ol className="list-decimal space-y-1 rounded-md border border-line bg-surface py-2 pl-8 pr-3 text-sm">
                {hints.map((h, i) => (
                  <li key={i}>{lt(h)}</li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{t("lessons.goalsTitle")}</p>
            <GoalList checks={lesson.checks} results={results} />
          </div>
        </div>
      )}
    </section>
  );
}
