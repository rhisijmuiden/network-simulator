import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../api";
import { Alert, Button, Card, Field, FormGrid, Input, Select, Spinner, Toggle } from "../../../components/ui";
import { useApi, useErrorText } from "../../../hooks";

type Schedule = { enabled: boolean; intervalHours: number; startTime: string; fullEveryDays: number; keepChains: number; passphraseSet: boolean };

export function Schedule() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { data, reload } = useApi<Schedule>("/api/backup/schedule");
  const [form, setForm] = useState<Schedule | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [pass, setPass] = useState({ current: "", next: "", repeat: "" });
  const [passMsg, setPassMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (!form) return <Spinner />;

  const save = async () => {
    try {
      const { passphraseSet: _p, ...body } = form;
      await api("/api/backup/schedule", { method: "PUT", body });
      setMsg({ tone: "ok", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "bad", text: errorText(err) });
    }
  };

  const savePass = async () => {
    if (pass.next !== pass.repeat) return setPassMsg({ tone: "bad", text: t("password.mismatch") });
    try {
      const r = await api<{ unreachable: string[] }>("/api/backup/passphrase", { method: "PUT", body: { current: pass.current, next: pass.next } });
      setPass({ current: "", next: "", repeat: "" });
      setPassMsg(
        r.unreachable.length
          ? { tone: "warn", text: t("backup.passUnreachable", { names: r.unreachable.join(", ") }) }
          : { tone: "ok", text: t("backup.passSaved") },
      );
      void reload();
    } catch (err) {
      setPassMsg({ tone: "bad", text: errorText(err) });
    }
  };

  const span = Math.round((form.fullEveryDays * form.keepChains) / 7);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t("backup.schedule")}>
        <div className="space-y-4">
          {!form.passphraseSet && <Alert tone="warn">{t("backup.needPassphrase")}</Alert>}
          <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label={t("backup.scheduleEnabled")} description={t("backup.scheduleHint")} />
          <FormGrid>
            <Field label={t("backup.every")}>
              {(id) => (
                <Select id={id} value={form.intervalHours} onChange={(e) => setForm({ ...form, intervalHours: Number(e.target.value) })}>
                  {[1, 2, 4, 6, 12, 24].map((h) => (
                    <option key={h} value={h}>
                      {h === 24 ? t("backup.daily") : t("backup.hours", { count: h })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("backup.startTime")}>{(id) => <Input id={id} type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />}</Field>
            <Field label={t("backup.fullEvery")} hint={t("backup.fullEveryHint")}>
              {(id) => <Input id={id} type="number" min={1} max={90} value={form.fullEveryDays} onChange={(e) => setForm({ ...form, fullEveryDays: Number(e.target.value) })} />}
            </Field>
            <Field label={t("backup.keep")} hint={t("backup.keepHint")}>
              {(id) => <Input id={id} type="number" min={1} max={100} value={form.keepChains} onChange={(e) => setForm({ ...form, keepChains: Number(e.target.value) })} />}
            </Field>
          </FormGrid>
          <p className="text-sm text-muted">{t("backup.retentionSummary", { weeks: span })}</p>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button variant="primary" onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </Card>
      <Card title={t("backup.encryption")}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t("backup.encryptionText")}</p>
          <Alert tone="info">{t("backup.storePassphrase")}</Alert>
          {form.passphraseSet && (
            <Field label={t("backup.currentPassphrase")}>{(id) => <Input id={id} type="password" value={pass.current} onChange={(e) => setPass({ ...pass, current: e.target.value })} />}</Field>
          )}
          <Field label={form.passphraseSet ? t("backup.newPassphrase") : t("backup.passphrase")} hint={t("backup.passphraseRules")}>
            {(id) => <Input id={id} type="password" minLength={12} value={pass.next} onChange={(e) => setPass({ ...pass, next: e.target.value })} />}
          </Field>
          <Field label={t("password.repeat")}>{(id) => <Input id={id} type="password" value={pass.repeat} onChange={(e) => setPass({ ...pass, repeat: e.target.value })} />}</Field>
          {passMsg && <Alert tone={passMsg.tone}>{passMsg.text}</Alert>}
          <Button icon={<KeyRound size={16} />} onClick={() => void savePass()} disabled={pass.next.length < 12}>
            {form.passphraseSet ? t("backup.changePassphrase") : t("backup.setPassphrase")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
