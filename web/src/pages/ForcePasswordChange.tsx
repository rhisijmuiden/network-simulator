import { useTranslation } from "react-i18next";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordForm } from "../components/PasswordForm";

export default function ForcePasswordChange() {
  const { t } = useTranslation();
  const { refresh, logout } = useAuth();
  return (
    <AuthLayout>
      <h2 className="display text-3xl">{t("password.forceTitle")}</h2>
      <p className="mb-6 mt-1 text-muted">{t("password.forceText")}</p>
      <PasswordForm onDone={() => void refresh()} />
      <button onClick={() => void logout()} className="mt-6 text-sm text-muted hover:text-ink">
        {t("top.logout")}
      </button>
    </AuthLayout>
  );
}
