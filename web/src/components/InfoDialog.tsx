import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { SystemInfo } from "../api";
import { useAuth } from "../auth";
import { useApi, useDateFormat } from "../hooks";
import { Badge, Modal, Spinner } from "./ui";
import { UpdatePanel } from "./UpdatePanel";

export function InfoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const fmt = useDateFormat();
  const { data } = useApi<SystemInfo>(open ? "/api/system/info" : null);
  return (
    <Modal open={open} onClose={onClose} title={t("info.title")}>
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-4 rounded-md bg-nacht p-4 text-white">
            <div>
              <div className="display text-2xl">Network Simulator</div>
              <div className="text-sm text-white/70">
                {t("info.version")} <span className="font-bold text-white">v{data.version}</span>
              </div>
            </div>
            <div className="ml-auto">
              <Badge tone={data.channel === "test" ? "warn" : "ok"}>{t(`updates.channels.${data.channel}`)}</Badge>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">{t("info.commit")}</dt>
            <dd>
              <code>{data.commit.slice(0, 12)}</code>
            </dd>
            <dt className="text-muted">{t("info.built")}</dt>
            <dd>{fmt(data.builtAt || null)}</dd>
            <dt className="text-muted">{t("info.database")}</dt>
            <dd>{t("info.schema", { version: data.schemaVersion })}</dd>
            <dt className="text-muted">Node.js</dt>
            <dd>{data.node}</dd>
          </dl>
          {user?.role === "admin" ? (
            <div className="border-t border-line pt-5">
              <UpdatePanel info={data} />
              <Link to="/admin/updates" onClick={onClose} className="mt-3 inline-block text-sm font-semibold text-accent-text hover:underline">
                {t("info.moreUpdates")}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted">{t("info.adminOnly")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
