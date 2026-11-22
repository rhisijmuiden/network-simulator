import { ArrowLeft, Check, Copy, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { LessonText } from "@netsim/engine";
import { api } from "../../api";
import { Alert, Button, Card, Empty, Modal, PageHeader, Spinner, Table, Td } from "../../components/ui";
import { useApi, useDateFormat, useErrorText } from "../../hooks";
import { GoalList, lessonPath, StatusBadge, useLessonText, type Attempt, type Lesson } from "../../lessons/common";

type Progress = {
  scenarios: { key: string; title: LessonText; level: number }[];
  students: { id: number; username: string; displayName: string; attempts: (Attempt & { scenarioKey: string })[]; assigned: { scenarioKey: string; dueAt: string | null }[] }[];
};
type Assignment = { id: number; scenarioKey: string; note: string; dueAt: string | null; createdAt: string; createdBy: string; userIds: number[] };
type Open = { student: string; attempt: Attempt & { scenarioKey: string } };

/** Teachers: who started, finished or is stuck on which scenario, and the assignments given. */
export default function LessonProgress() {
  const { t } = useTranslation();
  const lt = useLessonText();
  const fmt = useDateFormat();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const progress = useApi<Progress>("/api/lessons/progress");
  const assignments = useApi<Assignment[]>("/api/lessons/assignments");
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState("");

  if (progress.error) return <Alert tone="bad">{errorText(progress.error)}</Alert>;
  if (!progress.data) return <Spinner />;
  const p = progress.data;
  // Only scenarios that someone started or was given.
  const used = new Set(p.students.flatMap((s) => [...s.attempts.map((a) => a.scenarioKey), ...s.assigned.map((a) => a.scenarioKey)]));
  const columns = p.scenarios.filter((s) => used.has(s.key));
  const title = (key: string) => lt(p.scenarios.find((s) => s.key === key)?.title) || key;

  const removeAssignment = async (id: number) => {
    try {
      await api(`/api/lessons/assignments/${id}`, { method: "DELETE" });
      await Promise.all([assignments.reload(), progress.reload()]);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <Link to="/lessons" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> {t("lessons.title")}
      </Link>
      <PageHeader title={t("lessons.progress.title")} subtitle={t("lessons.progress.subtitle")} />
      {error && <div className="mb-4"><Alert tone="bad">{error}</Alert></div>}
      <Card title={t("lessons.progress.students")} className="mb-4">
        {!p.students.length ? (
          <Empty icon={<Users size={32} />} title={t("lessons.progress.noStudents")} text={t("lessons.progress.noStudentsText")} />
        ) : !columns.length ? (
          <p className="text-sm text-muted">{t("lessons.progress.nothingYet")}</p>
        ) : (
          <Table head={[t("lessons.progress.student"), ...columns.map((c) => <span key={c.key} className="block max-w-40 truncate normal-case" title={lt(c.title)}>{lt(c.title)}</span>)]}>
            {p.students.map((s) => (
              <tr key={s.id}>
                <Td className="whitespace-nowrap font-semibold">{s.displayName || s.username}</Td>
                {columns.map((c) => {
                  const a = s.attempts.find((x) => x.scenarioKey === c.key);
                  const given = s.assigned.find((x) => x.scenarioKey === c.key);
                  return (
                    <Td key={c.key}>
                      {a ? (
                        <button onClick={() => setOpen({ student: s.displayName || s.username, attempt: a })} className="flex items-center gap-1.5 text-left hover:underline">
                          {a.status === "completed" ? <Check size={15} className="text-ok" /> : null}
                          <span className="text-xs">
                            {a.status === "completed" ? t("lessons.status.completed") : `${a.passed}/${a.total}`}
                            <span className="block text-muted">{t("lessons.progress.hints", { count: a.hintsUsed })}</span>
                          </span>
                        </button>
                      ) : given ? (
                        <span className="text-xs text-muted">{t("lessons.progress.notStarted")}</span>
                      ) : null}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t("lessons.progress.assignments")}>
        {!assignments.data?.length ? (
          <p className="text-sm text-muted">{t("lessons.progress.noAssignments")}</p>
        ) : (
          <Table head={[t("lessons.progress.scenario"), t("lessons.assign.due"), t("lessons.progress.students"), t("lessons.progress.by"), ""]}>
            {assignments.data.map((a) => (
              <tr key={a.id}>
                <Td>
                  <Link to={lessonPath(a.scenarioKey)} className="font-semibold hover:text-accent-text">
                    {title(a.scenarioKey)}
                  </Link>
                  {a.note && <span className="block text-xs text-muted">{a.note}</span>}
                </Td>
                <Td>{a.dueAt ? fmt(a.dueAt) : "—"}</Td>
                <Td>{a.userIds.length}</Td>
                <Td>{a.createdBy}</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm" aria-label={t("common.delete")} onClick={() => removeAssignment(a.id)}>
                    <Trash2 size={15} />
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {open && <AttemptDialog open={open} title={title(open.attempt.scenarioKey)} onClose={() => setOpen(null)} onCopied={(id) => navigate(`/topologies/${id}`)} />}
    </>
  );
}

function AttemptDialog({ open, title, onClose, onCopied }: { open: Open; title: string; onClose: () => void; onCopied: (id: number) => void }) {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const errorText = useErrorText();
  const lesson = useApi<Lesson>(`/api/lessons/${encodeURIComponent(open.attempt.scenarioKey)}`);
  const [error, setError] = useState("");
  const a = open.attempt;
  const copy = async () => {
    try {
      const r = await api<{ id: number }>(`/api/lessons/attempts/${a.id}/copy`, { method: "POST" });
      onCopied(r.id);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${open.student}: ${title}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button icon={<Copy size={15} />} onClick={copy} disabled={!a.topologyId}>
            {t("lessons.progress.copy")}
          </Button>
        </>
      }
    >
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="mb-4 flex items-center gap-2">
        <StatusBadge attempt={a} />
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-muted">{t("lessons.started")}</dt>
        <dd>{fmt(a.startedAt)}</dd>
        <dt className="text-muted">{t("lessons.progress.lastCheck")}</dt>
        <dd>{fmt(a.lastCheckedAt)}</dd>
        <dt className="text-muted">{t("lessons.checksRun")}</dt>
        <dd>{a.checksRun}</dd>
        <dt className="text-muted">{t("lessons.hintsUsed")}</dt>
        <dd>{a.hintsUsed}</dd>
        {a.completedAt && (
          <>
            <dt className="text-muted">{t("lessons.completedAt")}</dt>
            <dd>{fmt(a.completedAt)}</dd>
          </>
        )}
      </dl>
      {lesson.data && <GoalList checks={lesson.data.checks} results={a.results.length ? a.results : undefined} />}
      <p className="mt-3 text-xs text-muted">{t("lessons.progress.copyHint")}</p>
    </Modal>
  );
}
