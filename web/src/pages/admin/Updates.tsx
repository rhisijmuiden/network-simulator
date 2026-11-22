import { useTranslation } from "react-i18next";
import type { SystemInfo } from "../../api";
import { Card, PageHeader, Spinner } from "../../components/ui";
import { UpdatePanel } from "../../components/UpdatePanel";
import { useApi, useDateFormat } from "../../hooks";

export default function Updates() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const { data } = useApi<SystemInfo>("/api/system/info");
  return (
    <>
      <PageHeader title={t("updates.title")} subtitle={t("updates.subtitle")} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card title={t("updates.title")}>
            <UpdatePanel info={data} />
          </Card>
          <Card title={t("updates.installedVersion")}>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted">{t("info.version")}</dt>
                <dd className="display text-xl">v{data.version}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("updates.channel")}</dt>
                <dd>{t(`updates.channels.${data.channel}`)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("info.commit")}</dt>
                <dd>
                  <code>{data.commit.slice(0, 12)}</code>
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t("info.built")}</dt>
                <dd>{fmt(data.builtAt || null)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted">{t("updates.howItWorks")}</p>
          </Card>
        </div>
      )}
    </>
  );
}
