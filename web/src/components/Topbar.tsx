import { Info, KeyRound, Languages, LogOut, Menu, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { LANGUAGES } from "../i18n";
import { setTheme, storedTheme, type ThemeChoice } from "../theme";
import { InfoDialog } from "./InfoDialog";

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>(storedTheme());
  const ref = useOutsideClose(menu, () => setMenu(false));

  const changeLanguage = async (lng: "en" | "nl") => {
    await i18n.changeLanguage(lng);
    if (user) {
      await api("/api/auth/profile", { method: "PUT", body: { displayName: user.displayName, email: user.email, language: lng } }).catch(() => {});
      void refresh();
    }
  };
  const cycleTheme = () => {
    const next: ThemeChoice = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    setThemeState(next);
  };
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-raised/85 px-4 backdrop-blur md:px-6">
      <button className="rounded-md p-2 text-muted hover:text-ink md:hidden" onClick={onMenu} aria-label={t("top.menu")}>
        <Menu size={20} />
      </button>
      <div className="flex-1" />
      <button
        onClick={() => setInfo(true)}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-muted hover:bg-surface hover:text-ink"
        title={t("info.title")}
      >
        <Info size={18} />
        <span className="hidden sm:inline">{t("top.info")}</span>
      </button>
      <div className="flex items-center rounded-md border border-line p-0.5" role="group" aria-label={t("top.language")}>
        <Languages size={16} className="mx-1.5 text-muted" />
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            onClick={() => void changeLanguage(l.code)}
            className={`rounded px-2 py-1 text-xs font-bold uppercase ${i18n.language === l.code ? "bg-nacht text-white dark:bg-lucht dark:text-nacht" : "text-muted hover:text-ink"}`}
            title={l.label}
          >
            {l.code}
          </button>
        ))}
      </div>
      <button onClick={cycleTheme} className="rounded-md p-2 text-muted hover:bg-surface hover:text-ink" title={t(`top.theme.${theme}`)}>
        <ThemeIcon size={18} />
      </button>
      <div className="relative" ref={ref}>
        <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-surface">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-nacht text-xs font-bold text-white dark:bg-lucht dark:text-nacht">
            {(user?.displayName || user?.username || "?").slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden text-left text-sm leading-tight lg:block">
            <span className="block font-semibold">{user?.displayName || user?.username}</span>
            <span className="block text-xs text-muted">{t(`roles.${user?.role}`)}</span>
          </span>
        </button>
        {menu && (
          <div className="absolute right-0 mt-2 w-52 rounded-md border border-line bg-raised py-1 shadow-xl">
            <MenuItem icon={<UserRound size={16} />} onClick={() => (setMenu(false), navigate("/profile"))}>
              {t("top.profile")}
            </MenuItem>
            <MenuItem icon={<KeyRound size={16} />} onClick={() => (setMenu(false), navigate("/profile#password"))}>
              {t("top.changePassword")}
            </MenuItem>
            <div className="my-1 border-t border-line" />
            <MenuItem icon={<LogOut size={16} />} onClick={() => void logout().then(() => navigate("/login"))}>
              {t("top.logout")}
            </MenuItem>
          </div>
        )}
      </div>
      <InfoDialog open={info} onClose={() => setInfo(false)} />
    </header>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface">
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}
