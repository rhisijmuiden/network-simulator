import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useErrorText } from "../hooks";
import { Alert, Button, Field, Input } from "./ui";

export function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return setError(new Error(t("password.mismatch")));
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/auth/password", { body: { current, next } });
      setCurrent("");
      setNext("");
      setRepeat("");
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("password.current")}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
      <Field label={t("password.new")} hint={t("password.rules")}>
        {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />}
      </Field>
      <Field label={t("password.repeat")}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />}</Field>
      {error ? <Alert tone="bad">{errorText(error)}</Alert> : null}
      <Button variant="primary" type="submit" disabled={busy}>
        {t("password.save")}
      </Button>
    </form>
  );
}
