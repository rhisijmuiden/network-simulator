import { ArrowRightLeft, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SystemInfo } from "../api";
import { useApi, useDateFormat, useErrorText } from "../hooks";
import { Alert, Badge, Button, Spinner, type Tone } from "./ui";

type Channel = "production" | "test";
type CheckResult = {
  current: { version: string; commit: string; branch: string };
  latest: { channel: Channel; version: string; commit: string; date: string; message: string };
  updateAvailable: boolean;
  channelChange: boolean;
};
type UpdateStatus = {
  state: string;
  message: string;
  fromVersion?: string;
  toVersion?: string;
  channel?: string;
  updatedAt?: string;
};

const ACTIVE = ["queued", "fetching", "building", "backup", "installing", "rolling-back"];

const stateTone = (s: string): Tone => (s === "completed" ? "ok" : s === "failed" ? "bad" : s === "rolled-back" ? "warn" : ACTIVE.includes(s) ? "info" : "neutral");

/** Channel switch, update check and "Update now". Used in the Info dialog and on the Updates page. */
export function UpdatePanel({ info }: { info: SystemInfo }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fmt = useDateFormat();
  const [channel, setChannel] = useState<Channel>(info.channel);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>();
  const [confirm, setConfirm] = useState(false);
  const status = useApi<UpdateStatus>("/api/system/updates/status", 3000);
  const active = status.data && ACTIVE.includes(status.data.state);

  // When an update finishes the server restarts with a new version: reload the page.
  const [wasActive, setWasActive] = useState(false);
  useEffect(() => {
    if (active) setWasActive(true);
    else if (wasActive && status.data?.state === "completed") setTimeout(() => window.location.reload(), 1500);
  }, [active, wasActive, status.data?.state]);

  const runCheck = async (ch: Channel) => {
    setChecking(true);
    setError(undefined);
    setConfirm(false);
    try {
      setCheck(await api<CheckResult>("/api/system/updates/check", { body: { channel: ch } }));
    } catch (err) {
      setCheck(null);
      setError(err);
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    if (!check) return;
    setError(undefined);
    try {
      await api("/api/system/updates/apply", { body: { channel, commit: check.latest.commit } });
      setConfirm(false);
      void status.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-semibold">{t("updates.channel")}</div>
        <div className="grid grid-cols-2 gap-2">
          {(["production", "test"] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                setChannel(c);
                void runCheck(c);
              }}
              className={`rounded-md border px-3 py-2.5 text-left transition ${channel === c ? "border-koraal bg-koraal/8" : "border-line hover:border-muted"}`}
            >
              <div className="flex items-center gap-2 text-sm font-bold">
                {t(`updates.channels.${c}`)}
                {info.channel === c && <Badge tone="ok">{t("updates.installed")}</Badge>}
              </div>
              <div className="text-xs text-muted">{t(`updates.channelHint.${c}`)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button icon={checking ? <Spinner /> : <RefreshCw size={16} />} onClick={() => void runCheck(channel)} disabled={checking || active}>
          {t("updates.check")}
        </Button>
      </div>

      {error ? <Alert tone="bad">{errorText(error)}</Alert> : null}

      {check && (
        <div className="rounded-md border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">{t("updates.latestOn", { channel: t(`updates.channels.${check.latest.channel}`) })}</div>
              <div className="display text-xl">v{check.latest.version}</div>
              <div className="text-xs text-muted">
                <code>{check.latest.commit.slice(0, 7)}</code> · {fmt(check.latest.date)} · {check.latest.message}
              </div>
            </div>
            {check.updateAvailable ? (
              <Badge tone="info">{check.channelChange ? t("updates.switchAvailable") : t("updates.available")}</Badge>
            ) : (
              <Badge tone="ok">
                <CheckCircle2 size={12} /> {t("updates.upToDate")}
              </Badge>
            )}
          </div>
          {check.updateAvailable && !confirm && (
            <div className="mt-4">
              <Button variant="primary" icon={check.channelChange ? <ArrowRightLeft size={16} /> : <Download size={16} />} onClick={() => setConfirm(true)} disabled={active}>
                {check.channelChange ? t("updates.switchTo", { channel: t(`updates.channels.${channel}`) }) : t("updates.updateNow")}
              </Button>
            </div>
          )}
          {confirm && (
            <div className="mt-4 space-y-3">
              <Alert tone="warn">
                {t("updates.confirmText")}
                {check.channelChange && channel === "production" && <p className="mt-2">{t("updates.downgradeWarning")}</p>}
              </Alert>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void apply()}>
                  {t("updates.confirm")}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {status.data && status.data.state !== "idle" && (
        <div className="flex items-start gap-3 rounded-md border border-line bg-surface p-3 text-sm">
          {active && <Spinner />}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{t("updates.lastRun")}</span>
              <Badge tone={stateTone(status.data.state)}>{t(`updates.state.${status.data.state}`, { defaultValue: status.data.state })}</Badge>
            </div>
            {status.data.message && <div className="mt-1 text-muted">{status.data.message}</div>}
            {status.data.updatedAt && <div className="mt-1 text-xs text-muted">{fmt(status.data.updatedAt)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
