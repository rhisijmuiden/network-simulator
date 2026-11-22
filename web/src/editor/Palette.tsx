import { useTranslation } from "react-i18next";
import { DEVICE_MODELS } from "@netsim/engine";
import { DeviceIcon } from "./glyphs";

/** Device models to drag onto the canvas (or click to add in the middle). */
export function Palette({ onAdd, disabled }: { onAdd: (model: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-[88px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-raised px-2 py-3">
      <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted">{t("editor.devices")}</div>
      {DEVICE_MODELS.map((m) => (
        <button
          key={m.id}
          draggable={!disabled}
          disabled={disabled}
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-netsim-model", m.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onAdd(m.id)}
          title={t("editor.dragHint")}
          className="group flex cursor-grab flex-col items-center gap-1 rounded-md px-1 py-2 text-center hover:bg-surface active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="transition group-hover:scale-105">
            <DeviceIcon kind={m.kind} size={42} />
          </span>
          <span className="text-[11px] font-semibold leading-tight">{t(`catalog.${m.label}`)}</span>
        </button>
      ))}
    </div>
  );
}
