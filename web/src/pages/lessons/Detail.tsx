import { ArrowLeft, Lightbulb, Pencil, Play, RotateCcw, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Spinner } from "../../components/ui";
import { useApi, useDateFormat, useErrorText } from "../../hooks";
import { GoalList, LevelBadge, StatusBadge, useLessonText, type Lesson } from "../../lessons/common";

type Student = { id: number; username: string; displayName: string };

export default function LessonDetail() {
  const { key = "" } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const lt = useLessonText();
  const fmt = useDateFormat();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const lesson = useApi<Lesson>(`/api/lessons/${encodeURIComponent(key)}`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState(false);
  const teacher = user?.role === "admin" || user?.role === "instructor";

  if (lesson.error) return <Alert tone="bad">{errorText(lesson.error)}</Alert>;
  if (!lesson.data) return <Spinner />;
  const l = lesson.data;
  const canEdit = !l.builtin && teacher && (user?.role === "admin" || l.ownerId === user?.id);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ topologyId: number }>(`/api/lessons/${encodeURIComponent(l.key)}/start`, { method: "POST" });
      navigate(`/topologies/${r.topologyId}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!l.attempt || !window.confirm(t("lessons.restartConfirm"))) return;
    try {
      await api(`/api/lessons/attempts/${l.attempt.id}/restart`, { method: "POST" });
      await lesson.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async () => {
    try {
      await api(`/api/lessons/scenarios/${l.key.slice(2)}`, { method: "DELETE" });
      navigate("/lessons");
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <Link to="/lessons" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> {t("lessons.title")}
      </Link>
      <PageHeader
        title={lt(l.title)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <LevelBadge level={l.level} />
            <StatusBadge attempt={l.attempt} />
            {!l.builtin && l.owner && <span className="text-sm">{t("lessons.by", { name: l.owner })}</span>}
            {!l.builtin && !l.published && <span className="text-sm">{t("lessons.draft")}</span>}
          </span>
        }
        actions={
          <>
            {canEdit && (
              <>
                <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => setRemoving(true)}>
                  {t("common.delete")}
                </Button>
                <Link to={`/lessons/edit/${l.key.slice(2)}`}>
                  <Button icon={<Pencil size={16} />}>{t("common.edit")}</Button>
                </Link>
              </>
            )}
            {teacher && (
              <Button icon={<Send size={16} />} onClick={() => setAssigning(true)}>
                {t("lessons.assign.button")}
              </Button>
            )}
            <Button variant="primary" icon={<Play size={16} />} onClick={start} disabled={busy}>
              {l.attempt ? t("lessons.continue") : t("lessons.start")}
            </Button>
          </>
        }
      />
      {error && <div className="mb-4"><Alert tone="bad">{error}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title={t("lessons.briefing")}>
            <p className="whitespace-pre-line text-sm leading-relaxed">{lt(l.briefing)}</p>
            {l.assignment && (
              <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="font-semibold">{l.assignment.dueAt ? t("lessons.dueAt", { date: fmt(l.assignment.dueAt) }) : t("lessons.assigned")}</span>
                {l.assignment.note && <span className="block text-muted">{l.assignment.note}</span>}
              </p>
            )}
          </Card>
          <Card title={t("lessons.goalsTitle")}>
            <GoalList checks={l.checks} results={l.attempt?.results} />
            <p className="mt-4 text-xs text-muted">{t("lessons.goalsHint")}</p>
          </Card>
        </div>
        <div className="space-y-4">
          {l.attempt && (
            <Card title={t("lessons.yourAttempt")}>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted">{t("lessons.started")}</dt>
                <dd>{fmt(l.attempt.startedAt)}</dd>
                <dt className="text-muted">{t("lessons.checksRun")}</dt>
                <dd>{l.attempt.checksRun}</dd>
                <dt className="text-muted">{t("lessons.hintsUsed")}</dt>
                <dd>
                  {l.attempt.hintsUsed} / {l.hintCount}
                </dd>
                {l.attempt.completedAt && (
                  <>
                    <dt className="text-muted">{t("lessons.completedAt")}</dt>
                    <dd>{fmt(l.attempt.completedAt)}</dd>
                  </>
                )}
              </dl>
              <Button className="mt-4" size="sm" icon={<RotateCcw size={14} />} onClick={restart}>
                {t("lessons.restart")}
              </Button>
            </Card>
          )}
          <Card title={t("lessons.hintsTitle")}>
            {l.hints.length ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {l.hints.map((h, i) => (
                  <li key={i}>{lt(h)}</li>
                ))}
              </ol>
            ) : (
              <p className="flex gap-2 text-sm text-muted">
                <Lightbulb size={17} className="shrink-0" />
                {t("lessons.hintsInEditor", { count: l.hintCount })}
              </p>
            )}
          </Card>
        </div>
      </div>
      <AssignDialog open={assigning} lessonKey={l.key} onClose={() => setAssigning(false)} />
      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        title={t("lessons.deleteTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={remove}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("lessons.deleteText", { title: lt(l.title) })}</p>
      </Modal>
    </>
  );
}

function AssignDialog({ open, lessonKey, onClose }: { open: boolean; lessonKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const students = useApi<Student[]>(open ? "/api/lessons/students" : null);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);

  const submit = async () => {
    setError("");
    try {
      const r = await api<{ students: number }>("/api/lessons/assignments", {
        body: { scenarioKey: lessonKey, userIds: all ? [] : picked, note, dueAt: due ? new Date(due).toISOString() : null },
      });
      setDone(r.students);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const close = () => {
    setDone(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("lessons.assign.title")}
      footer={
        done === null ? (
          <>
            <Button variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} disabled={!all && !picked.length}>
              {t("lessons.assign.button")}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{t("common.close")}</Button>
        )
      }
    >
      {done !== null ? (
        <Alert tone="ok">{t("lessons.assign.done", { count: done })}</Alert>
      ) : (
        <div className="space-y-4">
          {error && <Alert tone="bad">{error}</Alert>}
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={all} onChange={() => setAll(true)} /> {t("lessons.assign.all")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!all} onChange={() => setAll(false)} /> {t("lessons.assign.some")}
            </label>
          </div>
          {!all && (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm">
              {!students.data?.length && <p className="text-muted">{t("lessons.assign.noStudents")}</p>}
              {students.data?.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-surface">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                  {s.displayName || s.username} <span className="text-muted">{s.username}</span>
                </label>
              ))}
            </div>
          )}
          <Field label={t("lessons.assign.due")}>{(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
          <Field label={t("lessons.assign.note")}>{(id) => <Input id={id} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      )}
    </Modal>
  );
}
