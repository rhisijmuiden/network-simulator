import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { Alert, Button, Field, Input } from "../components/ui";
import { useErrorText } from "../hooks";

export default function Login() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const errorText = useErrorText();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(username, password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="display text-3xl">{t("login.title")}</h2>
      <p className="mb-6 mt-1 text-muted">{t("login.subtitle")}</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("login.username")}>{(id) => <Input id={id} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />}</Field>
        <Field label={t("login.password")}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        {error ? <Alert tone="bad">{errorText(error)}</Alert> : null}
        <Button variant="primary" type="submit" className="w-full" disabled={busy} icon={<LogIn size={16} />}>
          {t("login.submit")}
        </Button>
      </form>
      <p className="mt-6 text-xs text-muted">{t("login.forgot")}</p>
    </AuthLayout>
  );
}
