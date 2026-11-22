import { ArrowLeft, FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { CHECK_TYPES, newId, type Check, type CheckResult, type CheckType, type Topology } from "@netsim/engine";
import { api } from "../../api";
import { Alert, Button, Card, Field, FormGrid, Input, PageHeader, Select, Spinner, Toggle } from "../../components/ui";
import { useApi, useErrorText } from "../../hooks";
import { GoalList } from "../../lessons/common";

type TopologySummary = { id: number; name: string };
type Stored = { id: number; title: string; briefing: string; hints: string[]; level: number; published: boolean; checks: Check[]; data: Topology; canEdit: boolean };

const textareaCls = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-koraal focus:outline-none";

function blank(type: CheckType, devices: string[]): Check {
  const a = devices[0] ?? "";
  const b = devices[1] ?? a;
  const id = newId("c");
  switch (type) {
    case "ping":
      return { id, type, from: a, to: b, expect: "reach" };
    case "tcp":
      return { id, type, from: a, to: b, port: 80, expect: "open" };
    case "route":
      return { id, type, device: a, network: "10.0.0.0/24" };
    case "ospf":
      return { id, type, device: a, neighbor: b };
    case "bgp":
      return { id, type, device: a, peer: "192.0.2.1" };
    case "ipsec":
    case "dhcp":
      return { id, type, device: a };
    case "noErrors":
      return { id, type };
  }
}

/** Teachers write their own troubleshooting scenario: a start topology (with the faults in it), a briefing, hints and goals. */
export default function ScenarioEditor() {
  const { id } = useParams();
  const { t } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const stored = useApi<Stored>(id ? `/api/lessons/scenarios/${id}` : null);
  const topologies = useApi<TopologySummary[]>("/api/topologies");
  const [title, setTitle] = useState("");
  const [briefing, setBriefing] = useState("");
  const [hints, setHints] = useState<string[]>([""]);
  const [level, setLevel] = useState(1);
  const [published, setPublished] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [topologyId, setTopologyId] = useState<number | "">("");
  const [source, setSource] = useState<Topology | null>(null);
  const [results, setResults] = useState<CheckResult[] | undefined>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = stored.data;
    if (!s) return;
    setTitle(s.title);
    setBriefing(s.briefing);
    setHints(s.hints.length ? s.hints : [""]);
    setLevel(s.level);
    setPublished(s.published);
    setChecks(s.checks);
    setSource(s.data);
  }, [stored.data]);

  useEffect(() => {
    if (!topologyId) return;
    api<{ data: Topology }>(`/api/topologies/${topologyId}`).then((r) => setSource(r.data), (err) => setError(errorText(err)));
  }, [topologyId, errorText]);

  const devices = useMemo(() => (source?.devices ?? []).map((d) => d.name).sort(), [source]);
  const update = (i: number, patch: Partial<Check>) => setChecks((cs) => cs.map((c, j) => (j === i ? ({ ...c, ...patch } as Check) : c)));

  const body = () => ({ title, briefing, hints: hints.map((h) => h.trim()).filter(Boolean), level, published, checks, topologyId: topologyId || undefined });

  const saveIt = async () => {
    setError("");
    setSaving(true);
    try {
      if (id) {
        await api(`/api/lessons/scenarios/${id}`, { method: "PUT", body: body() });
        navigate(`/lessons/c%3A${id}`);
      } else {
        const r = await api<{ id: number }>("/api/lessons/scenarios", { body: body() });
        navigate(`/lessons/c%3A${r.id}`);
      }
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const tryChecks = async () => {
    setError("");
    try {
      const r = await api<{ results: CheckResult[] }>("/api/lessons/try-checks", { body: { topologyId, checks } });
      setResults(r.results);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (id && stored.loading) return <Spinner />;
  if (stored.error) return <Alert tone="bad">{errorText(stored.error)}</Alert>;
  const deviceSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="w-36!">
      {!devices.includes(value) && <option value={value}>{value || "—"}</option>}
      {devices.map((d) => (
        <option key={d}>{d}</option>
      ))}
    </Select>
  );

  return (
    <>
      <Link to="/lessons" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> {t("lessons.title")}
      </Link>
      <PageHeader
        title={id ? t("lessons.editor.editTitle") : t("lessons.newScenario")}
        subtitle={t("lessons.editor.subtitle")}
        actions={
          <Button variant="primary" icon={<Save size={16} />} onClick={saveIt} disabled={saving || !title.trim() || (!id && !topologyId) || !checks.length}>
            {t("common.save")}
          </Button>
        }
      />
      {error && <div className="mb-4"><Alert tone="bad">{error}</Alert></div>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t("lessons.editor.about")}>
          <div className="space-y-4">
            <Field label={t("lessons.editor.titleField")}>{(fid) => <Input id={fid} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label={t("lessons.briefing")} hint={t("lessons.editor.briefingHint")}>
              {(fid) => <textarea id={fid} rows={5} maxLength={4000} value={briefing} onChange={(e) => setBriefing(e.target.value)} className={textareaCls} />}
            </Field>
            <FormGrid>
              <Field label={t("lessons.editor.level")}>
                {(fid) => (
                  <Select id={fid} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {t(`lessons.level.${n}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={id ? t("lessons.editor.replaceStart") : t("lessons.editor.start")} hint={t("lessons.editor.startHint")}>
                {(fid) => (
                  <Select id={fid} value={topologyId} onChange={(e) => setTopologyId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">{id ? t("lessons.editor.keepStart") : "—"}</option>
                    {topologies.data?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
            <Toggle checked={published} onChange={setPublished} label={t("lessons.editor.published")} description={t("lessons.editor.publishedHint")} />
          </div>
        </Card>
        <Card title={t("lessons.hintsTitle")}>
          <p className="mb-3 text-sm text-muted">{t("lessons.editor.hintsHint")}</p>
          <div className="space-y-2">
            {hints.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input value={h} maxLength={1000} aria-label={t("lessons.editor.hint", { n: i + 1 })} placeholder={t("lessons.editor.hint", { n: i + 1 })} onChange={(e) => setHints((hs) => hs.map((x, j) => (j === i ? e.target.value : x)))} />
                <Button variant="ghost" aria-label={t("common.delete")} onClick={() => setHints((hs) => hs.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
          <Button className="mt-3" size="sm" icon={<Plus size={14} />} onClick={() => setHints((hs) => [...hs, ""])} disabled={hints.length >= 10}>
            {t("lessons.editor.addHint")}
          </Button>
        </Card>
        <Card
          title={t("lessons.goalsTitle")}
          className="xl:col-span-2"
          actions={
            <Button size="sm" icon={<FlaskConical size={14} />} onClick={tryChecks} disabled={!topologyId || !checks.length}>
              {t("lessons.editor.try")}
            </Button>
          }
        >
          <p className="mb-3 text-sm text-muted">{t("lessons.editor.checksHint")}</p>
          {!source && <Alert tone="info">{t("lessons.editor.pickStart")}</Alert>}
          <div className="space-y-2">
            {checks.map((c, i) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
                <Select value={c.type} aria-label={t("lessons.editor.checkType")} className="w-48!" onChange={(e) => setChecks((cs) => cs.map((x, j) => (j === i ? blank(e.target.value as CheckType, devices) : x)))}>
                  {CHECK_TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`lessons.checkTypes.${ty}`)}
                    </option>
                  ))}
                </Select>
                {(c.type === "ping" || c.type === "tcp") && (
                  <>
                    {deviceSelect(c.from, (v) => update(i, { from: v }), t("lessons.editor.from"))}
                    <span className="text-sm text-muted">→</span>
                    <Input className="w-36! font-mono" value={c.to} aria-label={t("lessons.editor.to")} list="lesson-devices" onChange={(e) => update(i, { to: e.target.value })} />
                  </>
                )}
                {c.type === "tcp" && <Input className="w-24! font-mono" type="number" min={1} max={65535} value={c.port} aria-label={t("lessons.editor.port")} onChange={(e) => update(i, { port: Number(e.target.value) })} />}
                {c.type === "ping" && (
                  <Select value={c.expect} className="w-40!" aria-label={t("lessons.editor.expect")} onChange={(e) => update(i, { expect: e.target.value as "reach" | "fail" })}>
                    <option value="reach">{t("lessons.editor.expectReach")}</option>
                    <option value="fail">{t("lessons.editor.expectFail")}</option>
                  </Select>
                )}
                {c.type === "tcp" && (
                  <Select value={c.expect} className="w-40!" aria-label={t("lessons.editor.expect")} onChange={(e) => update(i, { expect: e.target.value as "open" | "blocked" })}>
                    <option value="open">{t("lessons.editor.expectOpen")}</option>
                    <option value="blocked">{t("lessons.editor.expectBlocked")}</option>
                  </Select>
                )}
                {(c.type === "route" || c.type === "ospf" || c.type === "bgp" || c.type === "ipsec" || c.type === "dhcp") && deviceSelect(c.device, (v) => update(i, { device: v }), t("lessons.editor.device"))}
                {c.type === "route" && <Input className="w-40! font-mono" value={c.network} aria-label={t("lessons.editor.network")} onChange={(e) => update(i, { network: e.target.value })} />}
                {c.type === "ospf" && deviceSelect(c.neighbor, (v) => update(i, { neighbor: v }), t("lessons.editor.neighbor"))}
                {c.type === "bgp" && <Input className="w-36! font-mono" value={c.peer} aria-label={t("lessons.editor.peer")} onChange={(e) => update(i, { peer: e.target.value })} />}
                <Button variant="ghost" className="ml-auto" aria-label={t("common.delete")} onClick={() => setChecks((cs) => cs.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
          <datalist id="lesson-devices">
            {devices.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <Button className="mt-3" size="sm" icon={<Plus size={14} />} onClick={() => setChecks((cs) => [...cs, blank("ping", devices)])} disabled={checks.length >= 30}>
            {t("lessons.editor.addCheck")}
          </Button>
          {results && (
            <div className="mt-4 rounded-md border border-line bg-surface p-3">
              <p className="mb-2 text-sm font-semibold">{t("lessons.editor.tryResult")}</p>
              <GoalList checks={checks} results={results} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
