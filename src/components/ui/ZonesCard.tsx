import type { HrZones } from "@/lib/analysis/hr-zones";
import { LOAD_LEVELS } from "@/lib/analysis/hr-zones";
import { DASH, duration } from "@/lib/format";
import { LoadBadge } from "./Load";
import { Card } from "./primitives";

const ZONE_NAMES = ["Recuperación", "Aeróbico suave", "Aeróbico", "Umbral", "Máximo"];

/** Tiempo en cada zona de FC (con las muestras de la carrera) y carga. */
export function ZonesCard({
  seconds,
  load,
  zones,
  estimated = false,
  durationS,
}: {
  seconds: number[] | null;
  load: number | null;
  zones: HrZones;
  estimated?: boolean;
  durationS?: number | null;
}) {
  if (!seconds || seconds.reduce((a, b) => a + b, 0) <= 0) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div className="eyebrow">Zonas de pulso</div>
          <LoadBadge load={load} size="lg" estimated={estimated} />
        </div>
        <p className="mt-2 text-[14px] text-fg-2">
          Sin muestras de pulso en esta carrera: no hay tiempo en zonas.
          {estimated && load !== null && ` Carga estimada ≈${Math.round(load)} con el pulso medio (todo el tiempo en su zona).`}
          {load === null && " Sin pulso medio tampoco: la carga queda sin dato y no cuenta en Carga y forma."}
        </p>
      </Card>
    );
  }
  const total = seconds.reduce((a, b) => a + b, 0);
  const max = Math.max(...seconds);
  const coverage = durationS ? Math.min(1, total / durationS) : null;
  // Como el Apple Watch: Z1 = por debajo de Z2.
  const ranges = zones.limits.map((lo, i) => (i === 0 ? `< ${zones.limits[1]}` : i < 4 ? `${lo}–${zones.limits[i + 1] - 1}` : `≥ ${lo}`));
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="eyebrow">Zonas de pulso</div>
        <LoadBadge load={load} size="lg" estimated={estimated} />
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
      {estimated && load !== null && (
        <p className="mt-4 rounded-xl border border-line-strong bg-inset px-3 py-2 text-[13px] leading-snug">
          <b>Carga estimada ≈{Math.round(load)}.</b>{" "}
          {coverage !== null ? `El reloj solo guardó pulso en el ${Math.round(coverage * 100)} % de la carrera` : "Hay poco pulso"} (hace falta al menos el 80 %): se
          calcula con el pulso medio, como si toda la carrera fuera en su zona. Las zonas de arriba son solo de las muestras que hay.
        </p>
      )}
      <p className="mt-4 text-[12px] leading-relaxed text-fg-2">
        Carga = minutos en cada zona × 1…5. Verde por debajo de {LOAD_LEVELS.moderate}, naranja hasta {LOAD_LEVELS.high - 1}, rojo desde{" "}
        {LOAD_LEVELS.high}.
      </p>
    </Card>
  );
}
