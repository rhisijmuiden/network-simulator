import { BarChart3, CalendarClock, GraduationCap, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAuth } from "../../auth";
import { Alert, Button, Card, Empty, PageHeader, Select, Spinner } from "../../components/ui";
import { useApi, useDateFormat, useErrorText } from "../../hooks";
import { lessonPath, LevelBadge, StatusBadge, useLessonText, type Lesson } from "../../lessons/common";

type Filter = "all" | "assigned" | "open" | "done";

/** All scenarios: assigned ones first, with the student's own progress. */
export default function LessonList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lt = useLessonText();
  const fmt = useDateFormat();
  const errorText = useErrorText();
  const list = useApi<Lesson[]>("/api/lessons");
  const [filter, setFilter] = useState<Filter>("all");
  const teacher = user?.role === "admin" || user?.role === "instructor";

  const items = (list.data ?? [])
    .filter((l) => filter === "all" || (filter === "assigned" ? l.assignment : filter === "done" ? l.attempt?.status === "completed" : l.attempt?.status !== "completed"))
    .sort((a, b) => Number(!!b.assignment) - Number(!!a.assignment) || a.level - b.level);

  return (
    <>
      <PageHeader
        title={t("lessons.title")}
        subtitle={t("lessons.subtitle")}
        actions={
          teacher && (
            <>
              <Link to="/lessons/progress">
                <Button icon={<BarChart3 size={16} />}>{t("lessons.progress.title")}</Button>
              </Link>
              <Link to="/lessons/new">
                <Button variant="primary" icon={<Plus size={16} />}>
                  {t("lessons.newScenario")}
                </Button>
              </Link>
            </>
          )
        }
      />
      {list.error ? <Alert tone="bad">{errorText(list.error)}</Alert> : null}
      <div className="mb-4 flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={t("lessons.filter.label")} className="w-56!">
          {(["all", "assigned", "open", "done"] as const).map((f) => (
            <option key={f} value={f}>
              {t(`lessons.filter.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {list.loading ? (
        <Spinner />
      ) : !items.length ? (
        <Card>
          <Empty icon={<GraduationCap size={32} />} title={t("lessons.empty")} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((l) => (
            <Link key={l.key} to={lessonPath(l.key)} className="group flex flex-col rounded-lg border border-line bg-raised p-5 transition hover:border-koraal">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <LevelBadge level={l.level} />
                <StatusBadge attempt={l.attempt} />
                {!l.builtin && !l.published && <span className="text-xs text-muted">{t("lessons.draft")}</span>}
              </div>
              <h2 className="font-bold group-hover:text-accent-text">{lt(l.title)}</h2>
              <p className="mt-1 line-clamp-3 text-sm text-muted">{lt(l.briefing)}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs text-muted">
                <span>{t("lessons.goals", { count: l.checkCount ?? 0 })}</span>
                {l.topics.map((x) => (
                  <span key={x} className="uppercase tracking-wide">
                    {x}
                  </span>
                ))}
                {!l.builtin && l.owner && <span>{t("lessons.by", { name: l.owner })}</span>}
                {l.assignment && (
                  <span className="flex items-center gap-1 font-semibold text-accent-text">
                    <CalendarClock size={13} />
                    {l.assignment.dueAt ? t("lessons.dueAt", { date: fmt(l.assignment.dueAt) }) : t("lessons.assigned")}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
