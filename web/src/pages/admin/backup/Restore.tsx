import { ArchiveRestore, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../api";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner, Table, Td } from "../../../components/ui";
import { formatBytes, useApi, useDateFormat, useErrorText } from "../../../hooks";
import { LocationForm } from "./LocationForm";
import { emptyLocation, type BackupSummary, type Location, type LocationInput } from "./types";

type RestoreStatus = { state: string; message: string; backupId?: string; progress?: number; createdAt?: string; updatedAt: string };

export function Restore() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fmt = useDateFormat();
  const locations = useApi<Location[]>("/api/backup/locations");
  const status = useApi<RestoreStatus>("/api/backup/restore/status", 2500);
  const [source, setSource] = useState<string>("");
  const [other, setOther] = useState<LocationInput>(emptyLocation());
  const [passphrase, setPassphrase] = useState("");
  const [backups, setBackups] = useState<BackupSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pick, setPick] = useState<BackupSummary | null>(null);
  const [confirm, setConfirm] = useState("");

  const sourceBody = () => (source === "other" ? { location: other, passphrase: passphrase || undefined } : { locationId: Number(source), passphrase: passphrase || undefined });

  const find = async () => {
    setLoading(true);
    setError(undefined);
    setBackups(null);
    try {
      setBackups(await api<BackupSummary[]>("/api/backup/available", { body: sourceBody() }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (!pick) return;
    try {
      await api("/api/backup/restore", { body: { ...sourceBody(), chainId: pick.chainId, backupId: pick.id, confirm: "RESTORE" } });
      setPick(null);
      setConfirm("");
      void status.reload();
    } catch (err) {
      setError(err);
      setPick(null);
    }
  };

  const st = status.data;
  const busy = st && ["downloading", "staged", "applying"].includes(st.state);

  return (
    <div className="space-y-6">
      {st && st.state !== "idle" && (
        <Alert tone={st.state === "completed" ? "ok" : st.state === "failed" || st.state === "rolled-back" ? "bad" : "info"}>
          <div className="flex items-center gap-3">
            {busy && <Spinner />}
            <div>
              <div className="font-semibold">
                {t(`backup.restoreState.${st.state}`, { defaultValue: st.state })}
                {st.state === "downloading" && st.progress !== undefined ? ` ${st.progress}%` : ""}
              </div>
              {st.createdAt && <div className="text-xs">{t("backup.restoreOf", { date: fmt(st.createdAt) })}</div>}
              {st.message && <div className="text-xs">{errorText(new Error(st.message))}</div>}
              {st.state === "completed" && <div className="text-xs">{t("backup.restoreSignIn")}</div>}
            </div>
          </div>
        </Alert>
      )}
      <Card title={t("backup.restoreFrom")}>
        <div className="space-y-4">
          <Field label={t("backup.location")}>
            {(id) => (
              <Select id={id} value={source} onChange={(e) => (setSource(e.target.value), setBackups(null))}>
                <option value="">{t("backup.chooseLocation")}</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({t(`backup.types.${l.type}`)})
                  </option>
                ))}
                <option value="other">{t("backup.otherLocation")}</option>
              </Select>
            )}
          </Field>
          {source === "other" && (
            <div className="rounded-md border border-line p-4">
              <p className="mb-4 text-sm text-muted">{t("backup.otherHint")}</p>
              <LocationForm value={other} onChange={setOther} />
            </div>
          )}
          <Field label={t("backup.passphrase")} hint={source === "other" ? t("backup.passphraseOther") : t("backup.passphraseOptional")}>
            {(id) => <Input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
          </Field>
          <Button icon={loading ? <Spinner /> : <Search size={16} />} onClick={() => void find()} disabled={!source || loading}>
            {t("backup.findBackups")}
          </Button>
          {error ? <Alert tone="bad">{errorText(error)}</Alert> : null}
        </div>
      </Card>
      {backups && (
        <Card title={t("backup.available", { count: backups.length })}>
          <Table head={[t("backup.when"), t("backup.kind"), t("backup.version"), t("backup.size"), ""]}>
            {backups.map((b) => (
              <tr key={b.id}>
                <Td>
                  <div className="font-semibold">{fmt(b.createdAt)}</div>
                  <div className="text-xs text-muted">{b.hostname}</div>
                </Td>
                <Td>
                  <Badge tone={b.kind === "full" ? "info" : "neutral"}>{t(`backup.kinds.${b.kind}`)}</Badge>
                </Td>
                <Td>v{b.appVersion}</Td>
                <Td className="text-muted">{formatBytes(b.totalBytes)}</Td>
                <Td className="text-right">
                  <Button size="sm" icon={<ArchiveRestore size={14} />} onClick={() => setPick(b)} disabled={busy}>
                    {t("backup.restoreThis")}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Modal
        open={Boolean(pick)}
        onClose={() => setPick(null)}
        title={t("backup.confirmRestoreTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPick(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" disabled={confirm !== "RESTORE"} onClick={() => void restore()}>
              {t("backup.restoreThis")}
            </Button>
          </>
        }
      >
        {pick && (
          <div className="space-y-4">
            <Alert tone="warn">{t("backup.confirmRestoreText", { date: fmt(pick.createdAt) })}</Alert>
            <Field label={t("backup.typeRestore")}>{(id) => <Input id={id} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" />}</Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
