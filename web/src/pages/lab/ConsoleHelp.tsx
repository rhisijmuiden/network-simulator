import { MousePointerClick, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card, Empty, PageHeader, Spinner } from "../../components/ui";
import { useApi } from "../../hooks";

type Summary = { id: number; name: string; deviceCount: number };

const EXAMPLES = [
  "enable",
  "configure terminal",
  "interface gi0/0",
  "ip address 192.168.1.1 255.255.255.0",
  "no shutdown",
  "end",
  "show ip interface brief",
  "ping 192.168.1.10",
];

/** Explains the device console and links to the topologies where it is opened. */
export default function ConsoleHelp() {
  const { t } = useTranslation();
  const list = useApi<Summary[]>("/api/topologies");
  const keys = ["tab", "help", "history", "ctrlz", "abbrev", "do"] as const;
  return (
    <>
      <PageHeader title={t("consolePage.title")} subtitle={t("consolePage.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title={t("consolePage.howTitle")}>
            <p className="flex gap-3 text-sm">
              <MousePointerClick size={20} className="shrink-0 text-accent-text" />
              {t("consolePage.how")}
            </p>
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {keys.map((k) => (
                <li key={k} className="rounded-md border border-line px-3 py-2">
                  <span className="font-semibold">{t(`consolePage.keys.${k}.title`)}</span>
                  <span className="block text-muted">{t(`consolePage.keys.${k}.text`)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t("consolePage.exampleTitle")}>
            <pre className="overflow-x-auto rounded-md bg-nacht p-4 font-mono text-[12.5px] leading-relaxed text-white/90">
              {EXAMPLES.map((l, i) => `${i < 1 ? "R1>" : i < 2 ? "R1#" : i < 3 ? "R1(config)#" : i < 6 ? "R1(config-if)#" : "R1#"} ${l}`).join("\n")}
            </pre>
            <p className="mt-3 text-sm text-muted">{t("consolePage.exampleText")}</p>
          </Card>
        </div>
        <Card title={t("consolePage.topologies")}>
          {list.loading ? (
            <Spinner />
          ) : !list.data?.length ? (
            <Empty icon={<TerminalSquare size={32} />} title={t("consolePage.noTopologies")} text={<Link className="font-semibold text-accent-text hover:underline" to="/topologies">{t("consolePage.create")}</Link>} />
          ) : (
            <ul className="-my-2 divide-y divide-line">
              {list.data.map((s) => (
                <li key={s.id}>
                  <Link to={`/topologies/${s.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent-text">
                    <span className="truncate font-semibold">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted">{t("consolePage.devices", { count: s.deviceCount })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
