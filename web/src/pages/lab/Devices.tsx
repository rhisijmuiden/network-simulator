import { useTranslation } from "react-i18next";
import { DEVICE_MODELS, shortName } from "@netsim/engine";
import { Badge, Card, PageHeader } from "../../components/ui";
import { DeviceIcon } from "../../editor/glyphs";

/** Read-only overview of the device models that can be placed in a topology. */
export default function DeviceLibrary() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("devices.title")} subtitle={t("devices.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {DEVICE_MODELS.map((m) => {
          const groups = new Map<string, { names: string[]; speed: number; module?: string }>();
          for (const p of m.ports) {
            const key = p.module ?? `${p.prefix}-${p.speed}`;
            const g = groups.get(key) ?? { names: [], speed: p.speed, module: p.module };
            g.names.push(...p.slots.map((s) => shortName(p.prefix + s)));
            groups.set(key, g);
          }
          return (
            <Card key={m.id}>
              <div className="flex gap-4">
                <DeviceIcon kind={m.kind} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold">{t(`catalog.${m.label}`)}</h2>
                    <Badge>{t(`devices.kind.${m.kind}`)}</Badge>
                    <Badge tone="ok">{m.kind === "pc" || m.kind === "server" ? t("devices.cmd") : t("devices.cli")}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{m.platform}</p>
                  <p className="mt-2 text-sm">{t(`devices.about.${m.id}`)}</p>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {[...groups.values()].map((g, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{t("devices.ports", { count: g.names.length })}</span>
                        <span className="text-muted">{formatSpeed(g.speed)}</span>
                        <code className="text-xs text-muted">
                          {g.names.length > 1 ? `${g.names[0]} – ${g.names.at(-1)}` : g.names[0]}
                        </code>
                        {g.module && <span className="w-full text-xs text-muted">{g.module}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function formatSpeed(mbps: number): string {
  return mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s`;
}
