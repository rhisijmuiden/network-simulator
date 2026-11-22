import { PlugZap, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../api";
import { Alert, Button, Field, FormGrid, Input, Select, Spinner, Textarea, Toggle } from "../../../components/ui";
import { useErrorText } from "../../../hooks";
import { defaultPorts, type LocationInput, type LocationType } from "./types";

/** Form fields for a backup location, with Test connection and fingerprint trust. */
export function LocationForm({
  value,
  onChange,
  id,
  secretSet,
  onTrusted,
}: {
  value: LocationInput;
  onChange: (v: LocationInput) => void;
  id?: number;
  secretSet?: boolean;
  onTrusted?: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "bad" | "warn"; text: string; fingerprint?: string } | null>(null);
  const set = <K extends keyof LocationInput>(k: K, v: LocationInput[K]) => onChange({ ...value, [k]: v });
  const setOpt = (o: Partial<LocationInput["options"]>) => onChange({ ...value, options: { ...value.options, ...o } });
  const useKey = value.type === "scp" && value.options.authType === "key";

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await api<{ fingerprint: string; repositoryFound: boolean }>("/api/backup/locations/test", { body: { id, location: value } });
      setResult({ tone: "ok", text: r.repositoryFound ? t("backup.testOkExisting") : t("backup.testOk") });
    } catch (err) {
      if (err instanceof ApiError && typeof err.body.fingerprint === "string") {
        setResult({
          tone: "warn",
          text: err.code === "backup.fingerprintChanged" ? t("backup.fingerprintChanged") : t("backup.fingerprintUnknown"),
          fingerprint: err.body.fingerprint,
        });
      } else setResult({ tone: "bad", text: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  const trust = async (fingerprint: string) => {
    if (id) {
      await api(`/api/backup/locations/${id}/trust`, { body: { fingerprint } });
      onTrusted?.();
    }
    // Keep it in the form too, so an unsaved location (or a restore source) uses it.
    setOpt(value.type === "scp" ? { hostKeyFingerprint: fingerprint } : { tlsFingerprint: fingerprint });
    setResult({ tone: "ok", text: t("backup.trusted") });
  };

  return (
    <div className="space-y-4">
      <FormGrid>
        <Field label={t("backup.name")}>{(fid) => <Input id={fid} value={value.name} placeholder="NAS" onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label={t("backup.type")}>
          {(fid) => (
            <Select
              id={fid}
              value={value.type}
              onChange={(e) => {
                const type = e.target.value as LocationType;
                onChange({ ...value, type, port: defaultPorts[type] });
              }}
            >
              <option value="scp">{t("backup.types.scp")}</option>
              <option value="ftps">{t("backup.types.ftps")}</option>
              <option value="ftp">{t("backup.types.ftp")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("backup.host")}>{(fid) => <Input id={fid} value={value.host} placeholder="nas.example.lan" onChange={(e) => set("host", e.target.value)} />}</Field>
        <Field label={t("backup.port")}>{(fid) => <Input id={fid} type="number" value={value.port} onChange={(e) => set("port", Number(e.target.value))} />}</Field>
        <Field label={t("backup.username")}>{(fid) => <Input id={fid} value={value.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} />}</Field>
        {value.type === "scp" && (
          <Field label={t("backup.authType")}>
            {(fid) => (
              <Select id={fid} value={value.options.authType ?? "password"} onChange={(e) => setOpt({ authType: e.target.value as "password" | "key" })}>
                <option value="password">{t("backup.authPassword")}</option>
                <option value="key">{t("backup.authKey")}</option>
              </Select>
            )}
          </Field>
        )}
        {!useKey && (
          <Field label={t("backup.password")} hint={secretSet ? t("common.secretKept") : undefined}>
            {(fid) => <Input id={fid} type="password" autoComplete="new-password" value={value.secret} placeholder={secretSet ? "••••••••" : ""} onChange={(e) => set("secret", e.target.value)} />}
          </Field>
        )}
        <Field label={t("backup.path")} hint={t("backup.pathHint")}>
          {(fid) => <Input id={fid} value={value.path} onChange={(e) => set("path", e.target.value)} />}
        </Field>
      </FormGrid>
      {useKey && (
        <div className="space-y-4">
          <Field label={t("backup.privateKey")} hint={secretSet ? t("common.secretKept") : t("backup.privateKeyHint")}>
            {(fid) => <Textarea id={fid} rows={5} value={value.secret} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={(e) => set("secret", e.target.value)} />}
          </Field>
          <Field label={t("backup.keyPassphrase")}>
            {(fid) => <Input id={fid} type="password" value={value.keyPassphrase} onChange={(e) => set("keyPassphrase", e.target.value)} />}
          </Field>
        </div>
      )}
      {value.type === "ftps" && (
        <div className="space-y-3">
          <Toggle checked={Boolean(value.options.implicitTls)} onChange={(v) => onChange({ ...value, port: v ? 990 : 21, options: { ...value.options, implicitTls: v } })} label={t("backup.implicitTls")} description={t("backup.implicitTlsHint")} />
          <Toggle checked={value.options.verifyCertificate !== false} onChange={(v) => setOpt({ verifyCertificate: v })} label={t("backup.verifyCert")} description={t("backup.verifyCertHint")} />
        </div>
      )}
      {value.type === "ftp" && <Alert tone="warn">{t("backup.ftpWarning")}</Alert>}
      {(value.options.hostKeyFingerprint || value.options.tlsFingerprint) && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <ShieldCheck size={14} className="text-ok" /> {t("backup.pinned")} <code className="break-all">{value.options.hostKeyFingerprint || value.options.tlsFingerprint}</code>
        </p>
      )}
      <Toggle checked={value.enabled} onChange={(v) => set("enabled", v)} label={t("backup.enabled")} description={t("backup.enabledHint")} />
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={testing ? <Spinner /> : <PlugZap size={16} />} onClick={() => void test()} disabled={testing || !value.host}>
          {t("backup.test")}
        </Button>
      </div>
      {result && (
        <Alert tone={result.tone}>
          <p>{result.text}</p>
          {result.fingerprint && (
            <div className="mt-2 space-y-2">
              <code className="block break-all rounded bg-surface px-2 py-1 text-xs">{result.fingerprint}</code>
              <Button size="sm" variant="primary" icon={<ShieldCheck size={14} />} onClick={() => void trust(result.fingerprint!)}>
                {t("backup.trust")}
              </Button>
            </div>
          )}
        </Alert>
      )}
    </div>
  );
}
