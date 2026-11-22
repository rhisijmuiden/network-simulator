import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PoweredBy, ProductMark } from "./Logo";
import { NetworkBackdrop } from "./NetworkBackdrop";

/** Sign-in screens: nacht panel with an animated network, form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-nacht lg:flex lg:flex-col lg:justify-between lg:p-10">
        <NetworkBackdrop />
        <div className="relative">
          <ProductMark />
        </div>
        <div className="relative max-w-md">
          <h1 className="display text-4xl leading-tight text-white">
            {t("login.heroA")} <span className="whitespace-nowrap text-koraal">{t("login.heroB")}</span>
          </h1>
          <p className="mt-4 text-white/70">{t("login.heroText")}</p>
        </div>
        <div className="relative">
          <PoweredBy />
        </div>
      </div>
      <div className="flex items-center justify-center bg-surface p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="inline-block rounded-md bg-nacht p-3">
              <ProductMark />
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
