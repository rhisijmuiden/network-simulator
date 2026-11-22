import { History as HistoryIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Card, Empty, Spinner, Table, Td, type Tone } from "../../../components/ui";
import { formatBytes, useApi, useDateFormat } from "../../../hooks";

type Run = {
  id: number;
  location_name: string;
  kind: "full" | "incremental";
  trigger: string;
  status: "running" | "success" | "failed";
  bytes_total: number;
  bytes_uploaded: number;
  message: string;
  started_at: string;
  finished_at: string | null;
};

const tone: Record<Run["status"], Tone> = { running: "info", success: "ok", failed: "bad" };

export function History() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const { data } = useApi<{ running: boolean; runs: Run[] }>("/api/backup/runs", 4000);
  return (
    <Card title={t("backup.tabs.history")}>
      <Table
        head={[t("backup.when"), t("backup.location"), t("backup.kind"), t("backup.result"), t("backup.size")]}
        empty={data?.runs.length === 0 && <Empty icon={<HistoryIcon size={32} />} title={t("backup.noRuns")} />}
      >
        {data?.runs.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">
              {fmt(r.started_at)}
              <div className="text-xs text-muted">{t(`backup.trigger.${r.trigger}`)}</div>
            </Td>
            <Td>{r.location_name}</Td>
            <Td>
              <Badge tone={r.kind === "full" ? "info" : "neutral"}>{t(`backup.kinds.${r.kind}`)}</Badge>
            </Td>
            <Td>
              <div className="flex items-center gap-2">
                {r.status === "running" && <Spinner />}
                <Badge tone={tone[r.status]}>{t(`backup.status.${r.status}`)}</Badge>
              </div>
              {r.message && <div className="mt-1 max-w-xs text-xs text-muted">{r.message}</div>}
            </Td>
            <Td className="whitespace-nowrap text-muted">
              {r.bytes_total ? formatBytes(Number(r.bytes_total)) : "—"}
              {r.bytes_uploaded ? <div className="text-xs">{t("backup.uploaded", { size: formatBytes(Number(r.bytes_uploaded)) })}</div> : null}
            </Td>
          </tr>
        ))}
      </Table>
      {!data && <Spinner />}
    </Card>
  );
}
