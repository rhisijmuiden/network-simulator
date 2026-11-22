import { HardDrive, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../api";
import { Alert, Badge, Button, Card, Empty, Modal, Table, Td } from "../../../components/ui";
import { useApi, useErrorText } from "../../../hooks";
import { LocationForm } from "./LocationForm";
import { emptyLocation, type Location, type LocationInput } from "./types";

export function Locations() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const list = useApi<Location[]>("/api/backup/locations");
  const [edit, setEdit] = useState<{ id?: number; secretSet?: boolean; value: LocationInput } | null>(null);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const save = async () => {
    if (!edit) return;
    setError(undefined);
    try {
      if (edit.id) await api(`/api/backup/locations/${edit.id}`, { method: "PUT", body: edit.value });
      else await api("/api/backup/locations", { body: edit.value });
      setEdit(null);
      void list.reload();
    } catch (err) {
      setError(err);
    }
  };

  const remove = async (l: Location) => {
    if (!window.confirm(t("backup.confirmDelete", { name: l.name }))) return;
    await api(`/api/backup/locations/${l.id}`, { method: "DELETE" });
    void list.reload();
  };

  const run = async (l: Location, kind: "full" | "incremental") => {
    setNotice(null);
    try {
      await api("/api/backup/run", { body: { locationId: l.id, kind } });
      setNotice({ tone: "ok", text: t("backup.started", { name: l.name }) });
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    }
  };

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        title={t("backup.tabs.locations")}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => (setError(undefined), setEdit({ value: emptyLocation() }))}>
            {t("backup.addLocation")}
          </Button>
        }
      >
        <Table
          head={[t("backup.name"), t("backup.type"), t("backup.host"), ""]}
          empty={list.data?.length === 0 && <Empty icon={<HardDrive size={32} />} title={t("backup.noLocations")} text={t("backup.noLocationsText")} />}
        >
          {list.data?.map((l) => (
            <tr key={l.id}>
              <Td>
                <div className="font-semibold">{l.name}</div>
                {!l.enabled && <Badge>{t("backup.paused")}</Badge>}
              </Td>
              <Td>
                <Badge tone="info">{t(`backup.types.${l.type}`)}</Badge>
              </Td>
              <Td className="text-muted">
                {l.username ? `${l.username}@` : ""}
                {l.host}:{l.port}/{l.path}
              </Td>
              <Td className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  <Button size="sm" icon={<Play size={14} />} onClick={() => void run(l, "incremental")}>
                    {t("backup.backupNow")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void run(l, "full")}>
                    {t("backup.fullNow")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("common.edit")}
                    onClick={() => {
                      setError(undefined);
                      const { id, secretSet, ...rest } = l;
                      setEdit({ id, secretSet, value: { ...rest, secret: "", keyPassphrase: "" } });
                    }}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => void remove(l)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal
        wide
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.id ? t("backup.editLocation") : t("backup.addLocation")}
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
            <LocationForm value={edit.value} id={edit.id} secretSet={edit.secretSet} onChange={(value) => setEdit({ ...edit, value })} onTrusted={() => void list.reload()} />
            {error ? <Alert tone="bad">{errorText(error)}</Alert> : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
