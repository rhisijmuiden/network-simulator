import { KeyRound, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Role } from "../../api";
import { useAuth } from "../../auth";
import { Alert, Badge, Button, Card, Empty, Field, FormGrid, Input, Modal, PageHeader, Select, Table, Td, Toggle } from "../../components/ui";
import { useApi, useDateFormat, useErrorText } from "../../hooks";

type UserRow = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  language: "en" | "nl";
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

const blank = { username: "", displayName: "", email: "", role: "student" as Role, language: "en" as "en" | "nl", disabled: false };

export default function Users() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const fmt = useDateFormat();
  const errorText = useErrorText();
  const list = useApi<UserRow[]>("/api/users");
  const [edit, setEdit] = useState<(typeof blank & { id?: number }) | null>(null);
  const [error, setError] = useState<unknown>();
  const [otp, setOtp] = useState<{ username: string; password: string } | null>(null);

  const save = async () => {
    if (!edit) return;
    setError(undefined);
    try {
      if (edit.id) {
        await api(`/api/users/${edit.id}`, { method: "PUT", body: edit });
      } else {
        const r = await api<{ oneTimePassword?: string }>("/api/users", { body: edit });
        if (r.oneTimePassword) setOtp({ username: edit.username, password: r.oneTimePassword });
      }
      setEdit(null);
      void list.reload();
    } catch (err) {
      setError(err);
    }
  };

  const reset = async (u: UserRow) => {
    const r = await api<{ oneTimePassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
    setOtp({ username: u.username, password: r.oneTimePassword });
  };

  const remove = async (u: UserRow) => {
    if (!window.confirm(t("users.confirmDelete", { name: u.username }))) return;
    await api(`/api/users/${u.id}`, { method: "DELETE" });
    void list.reload();
  };

  return (
    <>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => (setError(undefined), setEdit({ ...blank }))}>
            {t("users.add")}
          </Button>
        }
      />
      <Card>
        <Table
          head={[t("users.username"), t("users.role"), t("users.email"), t("users.lastLogin"), ""]}
          empty={list.data?.length === 0 && <Empty icon={<UserRound size={32} />} title={t("users.empty")} />}
        >
          {list.data?.map((u) => (
            <tr key={u.id}>
              <Td>
                <div className="font-semibold">{u.displayName || u.username}</div>
                <div className="text-xs text-muted">{u.username}</div>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={u.role === "admin" ? "info" : "neutral"}>{t(`roles.${u.role}`)}</Badge>
                  {u.disabled && <Badge tone="bad">{t("users.disabled")}</Badge>}
                  {u.mustChangePassword && <Badge tone="warn">{t("users.mustChange")}</Badge>}
                </div>
              </Td>
              <Td className="text-muted">{u.email || "—"}</Td>
              <Td className="text-muted">{fmt(u.lastLoginAt)}</Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => (setError(undefined), setEdit({ ...u }))}>
                    <Pencil size={15} />
                  </Button>
                  <Button size="sm" variant="ghost" title={t("users.resetPassword")} onClick={() => void reset(u)}>
                    <KeyRound size={15} />
                  </Button>
                  {u.id !== me?.id && (
                    <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => void remove(u)}>
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.id ? t("users.edit") : t("users.add")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <FormGrid>
              <Field label={t("users.username")}>{(id) => <Input id={id} value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />}</Field>
              <Field label={t("users.displayName")}>{(id) => <Input id={id} value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />}</Field>
              <Field label={t("users.email")}>{(id) => <Input id={id} type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />}</Field>
              <Field label={t("users.role")} hint={t(`users.roleHint.${edit.role}`)}>
                {(id) => (
                  <Select id={id} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                    {(["student", "instructor", "admin"] as const).map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("users.language")}>
                {(id) => (
                  <Select id={id} value={edit.language} onChange={(e) => setEdit({ ...edit, language: e.target.value as "en" | "nl" })}>
                    <option value="en">English</option>
                    <option value="nl">Nederlands</option>
                  </Select>
                )}
              </Field>
            </FormGrid>
            <Toggle checked={edit.disabled} onChange={(v) => setEdit({ ...edit, disabled: v })} label={t("users.disabled")} description={t("users.disabledHint")} />
            {!edit.id && <p className="text-xs text-muted">{t("users.otpHint")}</p>}
            {error ? <Alert tone="bad">{errorText(error)}</Alert> : null}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(otp)} onClose={() => setOtp(null)} title={t("users.otpTitle")} footer={<Button onClick={() => setOtp(null)}>{t("common.close")}</Button>}>
        {otp && (
          <div className="space-y-3">
            <p className="text-sm">{t("users.otpText", { name: otp.username })}</p>
            <code className="block select-all rounded-md bg-nacht px-4 py-3 text-center text-lg font-bold tracking-wider text-white">{otp.password}</code>
          </div>
        )}
      </Modal>
    </>
  );
}
