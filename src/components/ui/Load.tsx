import { loadLevel } from "@/lib/analysis/hr-zones";

const LEVEL = {
  low: { color: "var(--load-low)", label: "baja" },
  moderate: { color: "var(--load-mod)", label: "moderada" },
  high: { color: "var(--load-high)", label: "alta" },
} as const;

/** Carga de la carrera: rayo + número, color verde/naranja/rojo según el valor. */
export function LoadBadge({ load, size = "sm", estimated = false }: { load: number | null; size?: "sm" | "lg"; estimated?: boolean }) {
  if (load === null) return null;
  const l = LEVEL[loadLevel(load)];
  const big = size === "lg";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${big ? "px-3 py-1.5 text-[15px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{ borderColor: `color-mix(in srgb, ${l.color} 45%, transparent)`, background: `color-mix(in srgb, ${l.color} 14%, transparent)` }}
      title={`Carga ${l.label}${estimated ? " (estimada con el pulso medio)" : ""}`}
      aria-label={`Carga ${Math.round(load)} (${l.label}${estimated ? ", estimada" : ""})`}
    >
      <svg width={big ? 16 : 12} height={big ? 16 : 12} viewBox="0 0 24 24" aria-hidden="true" style={{ color: l.color }}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
      </svg>
      <span className="num">{estimated ? "≈" : ""}{Math.round(load)}</span>
      {estimated && <span className="font-normal opacity-80">estimada</span>}
    </span>
  );
}
