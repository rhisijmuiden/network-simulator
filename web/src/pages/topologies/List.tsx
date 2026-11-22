import { Copy, Network, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { createFromTemplate, TEMPLATE_IDS, type TemplateId } from "@netsim/engine";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Textarea } from "../../components/ui";
import { useApi, useDateFormat, useErrorText } from "../../hooks";

type Summary = { id: number; name: string; description: string; owner: string; ownerId: number | null; deviceCount: number; linkCount: number; updatedAt: string };

export default function TopologyList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const fmt = useDateFormat();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const list = useApi<Summary[]>("/api/topologies");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const importFile = async (f: File) => {
    setError("");
    try {
      const json = JSON.parse(await f.text()) as { name?: string; description?: string; topology?: unknown };
      const r = await api<{ id: number }>("/api/topologies", {
        body: { name: (json.name || f.name.replace(/\.netsim\.json$|\.json$/i, "")).slice(0, 120), description: json.description ?? "", data: json.topology ?? json },
      });
      navigate(`/topologies/${r.id}`);
    } catch (err) {
      setError(err instanceof SyntaxError ? t("topologies.badFile") : errorText(err));
    }
  };

  const duplicate = async (s: Summary) => {
    try {
      await api(`/api/topologies/${s.id}/duplicate`, { method: "POST" });
      void list.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <PageHeader
        title={t("topologies.title")}
        subtitle={t("topologies.subtitle")}
        actions={
          <>
            <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            <Button icon={<Upload size={16} />} onClick={() => file.current?.click()}>
              {t("topologies.import")}
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              {t("topologies.new")}
            </Button>
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      {list.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !list.data?.length ? (
        <Card>
          <Empty icon={<Network size={36} />} title={t("topologies.emptyTitle")} text={t("topologies.emptyText")} />
          <div className="flex justify-center pb-4">
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              {t("topologies.new")}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((s) => (
            <div key={s.id} className="group flex flex-col rounded-lg border border-line bg-raised transition hover:border-muted hover:shadow-md">
              <Link to={`/topologies/${s.id}`} className="flex-1 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-nacht text-lucht">
                    <Network size={20} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate font-bold">{s.name}</h3>
                    <p className="text-xs text-muted">{t("topologies.counts", { devices: s.deviceCount, links: s.linkCount })}</p>
                  </div>
                </div>
                {s.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{s.description}</p>}
              </Link>
              <div className="flex items-center gap-1 border-t border-line px-4 py-2 text-xs text-muted">
                <span className="flex-1 truncate">
                  {fmt(s.updatedAt)}
                  {user?.role === "admin" && s.ownerId !== user.id && s.owner ? ` · ${s.owner}` : ""}
                </span>
                <button className="rounded p-1.5 hover:bg-surface hover:text-ink" title={t("topologies.duplicate")} onClick={() => void duplicate(s)}>
                  <Copy size={15} />
                </button>
                <button className="rounded p-1.5 hover:bg-bad/10 hover:text-bad" title={t("common.delete")} onClick={() => setRemoving(s)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <CreateDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/topologies/${id}`)} />
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t("topologies.deleteTitle")}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api(`/api/topologies/${removing!.id}`, { method: "DELETE" });
                  setRemoving(null);
                  void list.reload();
                } catch (err) {
                  setError(errorText(err));
                  setRemoving(null);
                }
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("topologies.deleteText", { name: removing?.name })}</p>
      </Modal>
    </>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<TemplateId>("switched");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: number }>("/api/topologies", {
        body: { name: name.trim() || t(`templates.${template}.title`), description, data: createFromTemplate(template) },
      });
      onCreated(r.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("topologies.new")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {t("topologies.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label={t("topologies.name")}>{(id) => <Input id={id} value={name} placeholder={t(`templates.${template}.title`)} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
        <Field label={t("topologies.description")}>{(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="font-sans text-sm" />}</Field>
        <div>
          <p className="mb-2 text-sm font-semibold">{t("topologies.startWith")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATE_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setTemplate(id)}
                className={`rounded-md border p-3 text-left transition ${template === id ? "border-koraal bg-koraal/8" : "border-line hover:border-muted"}`}
              >
                <span className="block text-sm font-bold">{t(`templates.${id}.title`)}</span>
                <span className="block text-xs text-muted">{t(`templates.${id}.text`)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
