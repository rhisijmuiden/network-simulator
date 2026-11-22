import { Construction } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Empty, PageHeader } from "../components/ui";

export default function ComingSoon({ feature, phase }: { feature: string; phase: number }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(`nav.${feature}`)} subtitle={t(`soon.${feature}`)} />
      <Card>
        <Empty icon={<Construction size={36} />} title={t("soon.title", { phase })} text={t("soon.text")} />
      </Card>
    </>
  );
}
