import { CheckCircle2, CircleDashed, DatabaseBackup, GraduationCap, Mail, Network, TerminalSquare, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { SystemInfo } from "../api";
import { useAuth } from "../auth";
import { Badge, Card, PageHeader } from "../components/ui";
import { useApi, useDateFormat } from "../hooks";
import { NetworkBackdrop } from "../components/NetworkBackdrop";

/** Highest finished phase. */
const DONE = 4;

const roadmap: { phase: number; key: string; icon: LucideIcon }[] = [
  { phase: 1, key: "foundation", icon: CheckCircle2 },
  { phase: 2, key: "engine", icon: Network },
  { phase: 3, key: "devices", icon: TerminalSquare },
  { phase: 4, key: "lessons", icon: GraduationCap },
];

type MailState = { enabled: boolean; host: string };
type Runs = { runs: { status: string; finished_at: string | null; started_at: string; location_name: string }[] };

function AdminStatus() {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const mail = useApi<MailState>("/api/settings/mail");
  const runs = useApi<Runs>("/api/backup/runs");
  const info = useApi<SystemInfo>("/api/system/info");
  const last = runs.data?.runs[0];
  const rows = [
    {
      icon: Mail,
      label: t("dashboard.mail"),
      ok: mail.data?.enabled,
      text: mail.data?.enabled ? mail.data.host : t("dashboard.notConfigured"),
      to: "/admin/mail",
    },
    {
      icon: DatabaseBackup,
      label: t("dashboard.backup"),
      ok: last?.status === "success",
      text: last ? `${t(`backup.status.${last.status}`)} · ${fmt(last.finished_at ?? last.started_at)}` : t("dashboard.noBackup"),
      to: "/admin/backup",
    },
  ];
  return (
    <Card title={t("dashboard.system")}>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label}>
            <Link to={r.to} className="flex items-center gap-3 rounded-md p-2 hover:bg-surface">
              <r.icon size={18} className="text-muted" />
              <span className="flex-1">
                <span className="block text-sm font-semibold">{r.label}</span>
                <span className="block text-xs text-muted">{r.text}</span>
              </span>
              <Badge tone={r.ok ? "ok" : "warn"}>{r.ok ? t("dashboard.ok") : t("dashboard.action")}</Badge>
            </Link>
          </li>
        ))}
        {info.data && (
          <li className="flex items-center gap-3 p-2 text-sm">
            <CircleDashed size={18} className="text-muted" />
            <span className="flex-1">
              v{info.data.version} · {t(`updates.channels.${info.data.channel}`)}
            </span>
          </li>
        )}
      </ul>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <>
      <div className="relative mb-8 overflow-hidden rounded-lg bg-nacht px-6 py-8 text-white md:px-10 md:py-10">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 opacity-70">
          <NetworkBackdrop />
        </div>
        <div className="relative max-w-xl">
          <div className="text-sm font-semibold uppercase tracking-wider text-lucht">{t("dashboard.welcomeBack")}</div>
          <h1 className="display mt-1 text-3xl md:text-4xl">{user?.displayName || user?.username}</h1>
          <p className="mt-3 text-white/75">{t("dashboard.intro")}</p>
        </div>
      </div>
      <PageHeader title={t("dashboard.roadmap")} subtitle={t("dashboard.roadmapText")} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-4 sm:grid-cols-2">
          {roadmap.map((r) => (
            <div key={r.key} className="rounded-lg border border-line bg-raised p-5">
              <div className="flex items-center justify-between">
                <span className={`flex h-10 w-10 items-center justify-center rounded-md ${r.phase <= DONE ? "bg-ok/12 text-ok" : "bg-koraal/12 text-accent-text"}`}>
                  <r.icon size={20} />
                </span>
                <Badge tone={r.phase <= DONE ? "ok" : "neutral"}>{t("dashboard.phase", { n: r.phase })}</Badge>
              </div>
              <h3 className="mt-4 font-bold">{t(`dashboard.phases.${r.key}.title`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`dashboard.phases.${r.key}.text`)}</p>
            </div>
          ))}
        </div>
        {user?.role === "admin" && <AdminStatus />}
      </div>
    </>
  );
}
