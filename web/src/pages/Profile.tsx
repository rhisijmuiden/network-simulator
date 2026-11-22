import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useAuth } from "../auth";
import { PasswordForm } from "../components/PasswordForm";
import { Alert, Button, Card, Field, FormGrid, Input, PageHeader, Select } from "../components/ui";
import { useErrorText } from "../hooks";
import { LANGUAGES } from "../i18n";

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const errorText = useErrorText();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [language, setLanguage] = useState<"en" | "nl">(user?.language ?? "en");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pwDone, setPwDone] = useState(false);

  const save = async () => {
    try {
      await api("/api/auth/profile", { method: "PUT", body: { displayName, email, language } });
      await i18n.changeLanguage(language);
      await refresh();
      setMsg({ tone: "ok", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "bad", text: errorText(err) });
    }
  };

  return (
    <>
      <PageHeader title={t("profile.title")} subtitle={user?.username} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("profile.details")}>
          <div className="space-y-4">
            <FormGrid>
              <Field label={t("users.displayName")}>{(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
              <Field label={t("users.email")}>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            </FormGrid>
            <Field label={t("users.language")}>
              {(id) => (
                <Select id={id} value={language} onChange={(e) => setLanguage(e.target.value as "en" | "nl")}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button variant="primary" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </Card>
        <Card title={<span id="password">{t("top.changePassword")}</span>}>
          {pwDone && (
            <div className="mb-4">
              <Alert tone="ok">{t("password.changed")}</Alert>
            </div>
          )}
          <PasswordForm onDone={() => setPwDone(true)} />
        </Card>
      </div>
    </>
  );
}
