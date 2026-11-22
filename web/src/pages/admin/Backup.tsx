import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader, Tabs } from "../../components/ui";
import { History } from "./backup/History";
import { Locations } from "./backup/Locations";
import { Restore } from "./backup/Restore";
import { Schedule } from "./backup/Schedule";

type Tab = "locations" | "schedule" | "history" | "restore";

export default function Backup() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "locations");
  useEffect(() => {
    const onHash = () => setTab((location.hash.slice(1) as Tab) || "locations");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const change = (v: Tab) => {
    setTab(v);
    history.replaceState(null, "", `#${v}`);
  };
  return (
    <>
      <PageHeader title={t("backup.title")} subtitle={t("backup.subtitle")} />
      <Tabs
        value={tab}
        onChange={change}
        tabs={[
          { id: "locations", label: t("backup.tabs.locations") },
          { id: "schedule", label: t("backup.tabs.schedule") },
          { id: "history", label: t("backup.tabs.history") },
          { id: "restore", label: t("backup.tabs.restore") },
        ]}
      />
      {tab === "locations" && <Locations />}
      {tab === "schedule" && <Schedule />}
      {tab === "history" && <History />}
      {tab === "restore" && <Restore />}
    </>
  );
}
