import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Alert, Button, Card, Field, FormGrid, Input, PageHeader, Select, Spinner, Textarea, Toggle } from "../../components/ui";
import { useApi, useErrorText } from "../../hooks";

type MailForm = {
  enabled: boolean;
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  authMethod: "none" | "login" | "plain" | "cram-md5";
  username: string;
  password: string | null;
  passwordSet?: boolean;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  minTlsVersion: "TLSv1.2" | "TLSv1.3";
  verifyCertificate: boolean;
  dkimDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string | null;
  dkimKeySet?: boolean;
};

const defaultPort = { starttls: 587, tls: 465, none: 25 } as const;

export default function MailSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorText = useErrorText();
  const { data, setData } = useApi<MailForm>("/api/settings/mail");
  const [form, setForm] = useState<MailForm | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [testTo, setTestTo] = useState(user?.email ?? "");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);
  if (!form) return <Spinner />;

  const set = <K extends keyof MailForm>(k: K, v: MailForm[K]) => setForm({ ...form, [k]: v });
  const payload = () => {
    const { passwordSet: _p, dkimKeySet: _d, ...rest } = form;
    return rest;
  };

  const save = async () => {
    setMsg(null);
    try {
      const saved = await api<MailForm>("/api/settings/mail", { method: "PUT", body: payload() });
      setData(saved);
      setForm(saved);
      setMsg({ tone: "ok", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "bad", text: errorText(err) });
    }
  };

  const test = async () => {
    setMsg(null);
    setTesting(true);
    try {
      await api("/api/settings/mail/test", { body: { to: testTo, settings: payload() } });
      setMsg({ tone: "ok", text: t("mail.testSent", { to: testTo }) });
    } catch (err) {
      setMsg({ tone: "bad", text: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("mail.title")}
        subtitle={t("mail.subtitle")}
        actions={
          <Button variant="primary" onClick={() => void save()}>
            {t("common.save")}
          </Button>
        }
      />
      {msg && (
        <div className="mb-5">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title={t("mail.server")}>
            <div className="space-y-4">
              <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label={t("mail.enabled")} description={t("mail.enabledHint")} />
              <FormGrid>
                <Field label={t("mail.host")}>{(id) => <Input id={id} value={form.host} placeholder="smtp.example.com" onChange={(e) => set("host", e.target.value)} />}</Field>
                <Field label={t("mail.port")}>{(id) => <Input id={id} type="number" value={form.port} onChange={(e) => set("port", Number(e.target.value))} />}</Field>
                <Field label={t("mail.security")} hint={t(`mail.securityHint.${form.security}`)}>
                  {(id) => (
                    <Select id={id} value={form.security} onChange={(e) => {
                      const s = e.target.value as MailForm["security"];
                      setForm({ ...form, security: s, port: defaultPort[s] });
                    }}>
                      <option value="starttls">{t("mail.securityOptions.starttls")}</option>
                      <option value="tls">{t("mail.securityOptions.tls")}</option>
                      <option value="none">{t("mail.securityOptions.none")}</option>
                    </Select>
                  )}
                </Field>
                <Field label={t("mail.minTls")}>
                  {(id) => (
                    <Select id={id} value={form.minTlsVersion} onChange={(e) => set("minTlsVersion", e.target.value as MailForm["minTlsVersion"])} disabled={form.security === "none"}>
                      <option value="TLSv1.2">TLS 1.2</option>
                      <option value="TLSv1.3">TLS 1.3</option>
                    </Select>
                  )}
                </Field>
              </FormGrid>
              <Toggle checked={form.verifyCertificate} onChange={(v) => set("verifyCertificate", v)} label={t("mail.verifyCert")} description={t("mail.verifyCertHint")} />
              {form.security === "none" && <Alert tone="warn">{t("mail.insecure")}</Alert>}
            </div>
          </Card>
          <Card title={t("mail.authentication")}>
            <FormGrid>
              <Field label={t("mail.authMethod")}>
                {(id) => (
                  <Select id={id} value={form.authMethod} onChange={(e) => set("authMethod", e.target.value as MailForm["authMethod"])}>
                    <option value="login">LOGIN</option>
                    <option value="plain">PLAIN</option>
                    <option value="cram-md5">CRAM-MD5</option>
                    <option value="none">{t("mail.noAuth")}</option>
                  </Select>
                )}
              </Field>
              <div />
              <Field label={t("mail.username")}>{(id) => <Input id={id} value={form.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} disabled={form.authMethod === "none"} />}</Field>
              <Field label={t("mail.password")} hint={form.passwordSet ? t("common.secretKept") : undefined}>
                {(id) => (
                  <Input id={id} type="password" autoComplete="new-password" value={form.password ?? ""} placeholder={form.passwordSet ? "••••••••" : ""} onChange={(e) => set("password", e.target.value)} disabled={form.authMethod === "none"} />
                )}
              </Field>
            </FormGrid>
          </Card>
          <Card title={t("mail.sender")}>
            <FormGrid>
              <Field label={t("mail.fromName")}>{(id) => <Input id={id} value={form.fromName} onChange={(e) => set("fromName", e.target.value)} />}</Field>
              <Field label={t("mail.fromAddress")}>{(id) => <Input id={id} type="email" value={form.fromAddress} placeholder="netsim@example.com" onChange={(e) => set("fromAddress", e.target.value)} />}</Field>
              <Field label={t("mail.replyTo")}>{(id) => <Input id={id} type="email" value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} />}</Field>
            </FormGrid>
          </Card>
          <Card title={t("mail.dkim")}>
            <p className="mb-4 text-sm text-muted">{t("mail.dkimHint")}</p>
            <FormGrid>
              <Field label={t("mail.dkimDomain")}>{(id) => <Input id={id} value={form.dkimDomain} placeholder="example.com" onChange={(e) => set("dkimDomain", e.target.value)} />}</Field>
              <Field label={t("mail.dkimSelector")}>{(id) => <Input id={id} value={form.dkimSelector} placeholder="netsim" onChange={(e) => set("dkimSelector", e.target.value)} />}</Field>
            </FormGrid>
            <div className="mt-4">
              <Field label={t("mail.dkimKey")} hint={form.dkimKeySet ? t("common.secretKept") : undefined}>
                {(id) => <Textarea id={id} rows={4} value={form.dkimPrivateKey ?? ""} placeholder="-----BEGIN PRIVATE KEY-----" onChange={(e) => set("dkimPrivateKey", e.target.value)} />}
              </Field>
            </div>
          </Card>
        </div>
        <div>
          <Card title={t("mail.test")}>
            <div className="space-y-3">
              <p className="text-sm text-muted">{t("mail.testHint")}</p>
              <Field label={t("mail.testTo")}>{(id) => <Input id={id} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />}</Field>
              <Button icon={testing ? <Spinner /> : <Send size={16} />} onClick={() => void test()} disabled={!testTo || testing}>
                {t("mail.sendTest")}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
