import { useTranslation } from "react-i18next";
import { Card, PageHeader, Table, Td } from "../../components/ui";
import { useApi, useDateFormat } from "../../hooks";

type Entry = { id: number; at: string; username: string; action: string; detail: Record<string, unknown>; ip: string };

export default function Audit() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const { data } = useApi<Entry[]>("/api/audit?limit=300");
  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <Card>
        <Table head={[t("audit.when"), t("audit.who"), t("audit.action"), t("audit.detail"), "IP"]}>
          {data?.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-muted">{fmt(e.at)}</Td>
              <Td className="font-semibold">{e.username}</Td>
              <Td>
                <code className="text-xs">{e.action}</code>
              </Td>
              <Td className="max-w-md truncate text-xs text-muted">{Object.keys(e.detail).length ? JSON.stringify(e.detail) : ""}</Td>
              <Td className="text-xs text-muted">{e.ip}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
