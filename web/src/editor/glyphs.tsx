import type { DeviceKind, FrameKind } from "@netsim/engine";

/** Size of a device tile on the canvas, in world units. */
export const TILE = 56;

/** Simple line glyphs in the spirit of network diagram symbols, drawn in a 24x24 box. */
function Glyph({ kind }: { kind: DeviceKind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "router":
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 4.5v5M10 7l2-2.5L14 7M12 19.5v-5M10 17l2 2.5 2-2.5M4.5 12h5M7 10l-2.5 2L7 14M19.5 12h-5M17 10l2.5 2-2.5 2" />
        </g>
      );
    case "switch":
      return (
        <g {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="M6 10h11M14.5 7.8 17 10l-2.5 2.2M18 14H7M9.5 11.8 7 14l2.5 2.2" />
        </g>
      );
    case "l3switch":
      return (
        <g {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="M6 10h11M14.5 7.8 17 10l-2.5 2.2M18 14H7M9.5 11.8 7 14l2.5 2.2" />
          <circle cx="19.5" cy="5" r="3.2" fill="var(--koraal)" stroke="none" />
        </g>
      );
    case "pc":
      return (
        <g {...common}>
          <rect x="3" y="4" width="18" height="12" rx="1.8" />
          <path d="M9 20h6M12 16v4" />
        </g>
      );
    case "server":
      return (
        <g {...common}>
          <rect x="5" y="2.5" width="14" height="19" rx="2" />
          <path d="M8 7h8M8 11h8" />
          <circle cx="12" cy="17" r="1.2" fill="currentColor" />
        </g>
      );
  }
}

export function DeviceTile({ kind, size = TILE, selected, dim }: { kind: DeviceKind; size?: number; selected?: boolean; dim?: boolean }) {
  const host = kind === "pc" || kind === "server";
  return (
    <g opacity={dim ? 0.45 : 1}>
      {selected && <rect x={-size / 2 - 5} y={-size / 2 - 5} width={size + 10} height={size + 10} rx={16} fill="none" stroke="var(--koraal)" strokeWidth={2.5} />}
      <rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        rx={13}
        fill={host ? "var(--surface-raised)" : "var(--tile)"}
        stroke={host ? "var(--line)" : "rgba(156,195,255,0.35)"}
        strokeWidth={1.5}
      />
      <g transform={`translate(${-size * 0.3}, ${-size * 0.3}) scale(${(size * 0.6) / 24})`} color={host ? "var(--ink)" : "#ffffff"}>
        <Glyph kind={kind} />
      </g>
    </g>
  );
}

/** Stand-alone icon for the palette and lists. */
export function DeviceIcon({ kind, size = 40 }: { kind: DeviceKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`${-TILE / 2 - 2} ${-TILE / 2 - 2} ${TILE + 4} ${TILE + 4}`} aria-hidden="true">
      <DeviceTile kind={kind} />
    </svg>
  );
}

export const PACKET_COLORS: Record<FrameKind, string> = {
  "arp-request": "var(--lucht)",
  "arp-reply": "var(--lucht)",
  "echo-request": "var(--koraal)",
  "echo-reply": "var(--status-online)",
  "time-exceeded": "var(--status-warning)",
  unreachable: "var(--status-warning)",
  tcp: "#B58CFF",
  udp: "#B58CFF",
};
