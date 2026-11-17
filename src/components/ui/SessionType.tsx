import type { ReactNode } from "react";
import { TYPE_META, type SessionType } from "@/lib/analysis/session-type";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const ICONS: Record<SessionType, ReactNode> = {
  rodaje: <path {...s} d="M3 16c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 2 3 2" />,
  tirada_larga: <path {...s} d="M5 20 9.5 4M19 20 14.5 4M12 6v2.5M12 11v2.5M12 16v3" />,
  series: <path {...s} d="M4 19v-6M9 19V7M14 19v-9M19 19V5" />,
  tempo: (
    <g {...s}>
      <path d="M4.5 17a7.5 7.5 0 1 1 15 0" />
      <path d="m12 17 4.2-5" />
    </g>
  ),
  recuperacion: <path {...s} d="M12 20s-7-4.3-7-9.8A4 4 0 0 1 12 7.6a4 4 0 0 1 7 2.6C19 15.7 12 20 12 20z" />,
  competicion: (
    <g {...s}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M12 13v4M8.5 20h7M8 6H5.5a2.5 2.5 0 0 0 2.6 3.4M16 6h2.5a2.5 2.5 0 0 1-2.6 3.4" />
    </g>
  ),
  trail: <path {...s} d="M3 19 9 9l3.5 5.5L15 11l6 8z" />,
  cinta: <path {...s} d="M4 17h16M6 17l2-8h8l2 8M9 9V6h6v3" />,
};

export function SessionIcon({ type, size = 18 }: { type: SessionType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[type]}
    </svg>
  );
}

/** Etiqueta del tipo: icono con su color + nombre (nunca solo color). */
export function TypeTag({ type, manual = false }: { type: SessionType; manual?: boolean }) {
  const m = TYPE_META[type];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{
        borderColor: `color-mix(in srgb, ${m.color} 40%, transparent)`,
        color: "var(--fg)",
        background: `color-mix(in srgb, ${m.color} 12%, transparent)`,
      }}
      title={manual ? `${m.label} (elegido a mano)` : m.label}
    >
      <span style={{ color: m.color }} className="flex">
        <SessionIcon type={type} size={13} />
      </span>
      {m.label}
    </span>
  );
}
