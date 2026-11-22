import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Check, CheckResult, LessonText } from "@netsim/engine";
import { Badge } from "../components/ui";

export type Attempt = {
  id: number;
  topologyId: number | null;
  status: "started" | "completed";
  hintsUsed: number;
  checksRun: number;
  passed: number;
  total: number;
  results: CheckResult[];
  startedAt: string;
  lastCheckedAt: string | null;
  completedAt: string | null;
};

export type Lesson = {
  key: string;
  builtin: boolean;
  level: number;
  topics: string[];
  title: LessonText;
  briefing: LessonText;
  hints: LessonText[];
  hintCount: number;
  checks: Check[];
  checkCount?: number;
  owner?: string;
  ownerId?: number | null;
  published?: boolean;
  attempt: Attempt | null;
  assignment?: { dueAt: string | null; note: string } | null;
};

/** Picks the current language from a text that is either plain or in both languages. */
export function useLessonText() {
  const { i18n } = useTranslation();
  return useCallback((t: LessonText | undefined) => (!t ? "" : typeof t === "string" ? t : i18n.language.startsWith("nl") ? t.nl : t.en), [i18n.language]);
}

export const lessonPath = (key: string) => `/lessons/${encodeURIComponent(key)}`;

/** One goal of a scenario, in words. */
export function CheckText({ check }: { check: Check }) {
  const { t } = useTranslation();
  switch (check.type) {
    case "ping":
      return <>{t(`lessons.checks.ping.${check.expect}`, { from: check.from, to: check.to })}</>;
    case "tcp":
      return <>{t(`lessons.checks.tcp.${check.expect}`, { from: check.from, to: check.to, port: check.port })}</>;
    case "route":
      return <>{t("lessons.checks.route", { device: check.device, network: check.network })}</>;
    case "ospf":
      return <>{t("lessons.checks.ospf", { device: check.device, neighbor: check.neighbor })}</>;
    case "bgp":
      return <>{t("lessons.checks.bgp", { device: check.device, peer: check.peer })}</>;
    case "ipsec":
    case "dhcp":
      return <>{t(`lessons.checks.${check.type}`, { device: check.device })}</>;
    case "noErrors":
      return <>{t("lessons.checks.noErrors")}</>;
  }
}

/** The goals with their last result. */
export function GoalList({ checks, results }: { checks: Check[]; results?: CheckResult[] }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => {
        const r = results?.find((x) => x.id === c.id);
        return (
          <li key={c.id} className="flex gap-2 text-sm">
            {!r ? <Circle size={17} className="mt-0.5 shrink-0 text-muted" /> : r.passed ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={17} className="mt-0.5 shrink-0 text-bad" />}
            <span>
              <CheckText check={c} />
              {r && !r.passed && r.why && <span className="block text-xs text-muted">{t(`lessons.why.${r.why}`, { detail: r.detail ?? "" })}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function LevelBadge({ level }: { level: number }) {
  const { t } = useTranslation();
  return <Badge tone={level === 1 ? "ok" : level === 2 ? "info" : "warn"}>{t(`lessons.level.${level}`)}</Badge>;
}

export function StatusBadge({ attempt }: { attempt: Attempt | null }) {
  const { t } = useTranslation();
  if (!attempt) return <Badge>{t("lessons.status.new")}</Badge>;
  if (attempt.status === "completed") return <Badge tone="ok">{t("lessons.status.completed")}</Badge>;
  return <Badge tone="info">{t("lessons.status.started", { passed: attempt.passed, total: attempt.total })}</Badge>;
}
