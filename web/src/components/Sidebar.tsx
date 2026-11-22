import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { useAuth } from "../auth";
import { navigation } from "../nav";
import { PoweredBy, ProductMark } from "./Logo";

/** Left menu, always nacht: the RHIS dark surface with coral for the active item. */
export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-nacht text-white transition-transform md:static md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="px-5 py-5">
        <ProductMark />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {navigation.map((group) => {
          const items = group.items.filter((i) => !i.roles || (user && i.roles.includes(user.role)));
          if (!items.length) return null;
          return (
            <div key={group.label} className="mt-4 first:mt-0">
              <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">{t(group.label)}</div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                          isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-koraal" />}
                          <item.icon size={18} className={`shrink-0 ${isActive ? "text-koraal" : ""}`} />
                          <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
                          {item.phase && (
                            <span className="shrink-0 rounded-full bg-lucht/15 px-1.5 py-0.5 text-[10px] font-semibold text-lucht">{t("nav.soon")}</span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <PoweredBy />
      </div>
    </aside>
  );
}
