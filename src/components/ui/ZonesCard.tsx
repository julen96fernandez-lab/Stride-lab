import type { HrZones } from "@/lib/analysis/hr-zones";
import { LOAD_LEVELS } from "@/lib/analysis/hr-zones";
import { DASH, duration } from "@/lib/format";
import { LoadBadge } from "./Load";
import { Card } from "./primitives";

const ZONE_NAMES = ["Recuperación", "Aeróbico suave", "Aeróbico", "Umbral", "Máximo"];

/** Tiempo en cada zona de FC (con las muestras de la carrera) y carga. */
export function ZonesCard({ seconds, load, zones }: { seconds: number[] | null; load: number | null; zones: HrZones }) {
  if (!seconds || seconds.reduce((a, b) => a + b, 0) <= 0) {
    return (
      <Card>
        <div className="eyebrow">Zonas de pulso</div>
        <p className="mt-2 text-[14px] text-fg-2">Sin muestras de pulso en esta carrera.</p>
      </Card>
    );
  }
  const total = seconds.reduce((a, b) => a + b, 0);
  const max = Math.max(...seconds);
  // Como el Apple Watch: Z1 = por debajo de Z2.
  const ranges = zones.limits.map((lo, i) => (i === 0 ? `< ${zones.limits[1]}` : i < 4 ? `${lo}–${zones.limits[i + 1] - 1}` : `≥ ${lo}`));
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="eyebrow">Zonas de pulso</div>
        <LoadBadge load={load} size="lg" />
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {seconds.map((sec, i) => {
          const pct = (100 * sec) / total;
          return (
            <li key={i} className="grid grid-cols-[34px_1fr_auto] items-center gap-3">
              <span className="num text-[15px]" style={{ color: `var(--z${i + 1})` }}>
                Z{i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between text-[11px] text-fg-2">
                  <span className="truncate">{ZONE_NAMES[i]}</span>
                  <span>{ranges[i]} ppm</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-ov-2">
                  <div className="h-full rounded-full" style={{ width: `${max ? (100 * sec) / max : 0}%`, background: `var(--z${i + 1})` }} />
                </div>
              </div>
              <div className="w-[76px] text-right">
                <div className="num text-[15px]">{sec >= 1 ? duration(sec) : DASH}</div>
                <div className="text-[11px] text-fg-2">{Math.round(pct)} %</div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[12px] leading-relaxed text-fg-2">
        Carga = minutos en cada zona × 1…5. Verde por debajo de {LOAD_LEVELS.moderate}, naranja hasta {LOAD_LEVELS.high - 1}, rojo desde{" "}
        {LOAD_LEVELS.high}.
      </p>
    </Card>
  );
}
