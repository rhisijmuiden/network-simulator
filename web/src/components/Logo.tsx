import logoWhite from "@brand/logo/rhis-logo-wit.svg";
import icon from "@brand/logo/rhis-icon.svg";

/** Product mark in the sidebar: RHIS icon + product name, "Powered by RHIS" style. */
export function ProductMark({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src={icon} alt="" className="h-9 w-9 rounded-md" />
      {!collapsed && (
        <div className="leading-tight">
          <div className="display text-[15px] text-white">Network</div>
          <div className="display text-[15px] text-koraal">Simulator</div>
        </div>
      )}
    </div>
  );
}

export function PoweredBy() {
  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/50">
      <span>Powered by</span>
      <img src={logoWhite} alt="RHIS" className="h-3 opacity-70" />
    </div>
  );
}
