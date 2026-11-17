/**
 * Tipos de sesión y clasificación automática por reglas simples.
 * Orden de las reglas (la primera que se cumple gana):
 *   1. Series        → el reloj marcó intervalos (WOIntervalStepKeyPath)
 *   2. Cinta         → entrenamiento indoor
 *   3. Tirada larga  → distancia ≥ longRunKm (15 km por defecto)
 *   4. Trail         → desnivel positivo ≥ trailMPerKm metros por km
 *   5. Tempo / Recuperación / Rodaje → ritmo y pulso frente a tu media de los
 *      12 meses anteriores (rodajes comparables: sin cinta, sin series, sin especiales)
 * Competición nunca se adivina: solo a mano.
 */

export const SESSION_TYPES = [
  "rodaje",
  "tirada_larga",
  "series",
  "tempo",
  "recuperacion",
  "competicion",
  "trail",
  "cinta",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export function isSessionType(v: unknown): v is SessionType {
  return typeof v === "string" && (SESSION_TYPES as readonly string[]).includes(v);
}

/**
 * Colores: paleta categórica validada para la superficie oscuro #151712 (orden fijo,
 * nunca se cicla). Cada tipo lleva además icono y nombre: el color nunca va solo.
 */
export const TYPE_META: Record<SessionType, { label: string; color: string }> = {
  rodaje: { label: "Rodaje", color: "#3987e5" },
  tirada_larga: { label: "Tirada larga", color: "#d95926" },
  series: { label: "Series", color: "#199e70" },
  tempo: { label: "Tempo", color: "#c98500" },
  recuperacion: { label: "Recuperación", color: "#d55181" },
  competicion: { label: "Competición", color: "#0ca30c" },
  trail: { label: "Trail", color: "#9085e9" },
  cinta: { label: "Cinta", color: "#e66767" },
};

export interface TypeSettings {
  longRunKm: number;
  trailMPerKm: number;
}
export const DEFAULT_TYPE_SETTINGS: TypeSettings = { longRunKm: 15, trailMPerKm: 25 };

/** Umbrales de ritmo/pulso frente a la media (fijos y explicados en el motivo). */
const TEMPO_PACE = 0.04; // ≥ 4 % más rápido que tu media…
const TEMPO_HR = 3; // …y ≥ 3 ppm por encima
const TEMPO_PACE_NO_HR = 0.07; // sin pulso: ≥ 7 % más rápido
const RECOV_PACE = 0.06; // ≥ 6 % más lento…
const RECOV_HR = 3; // …y ≥ 3 ppm por debajo
const RECOV_PACE_NO_HR = 0.1; // sin pulso: ≥ 10 % más lento
const BASELINE_DAYS = 365;
const MIN_BASELINE_RUNS = 5;

export interface RunForType {
  id: string;
  startAt: Date;
  distanceM: number | null;
  avgPaceSPerKm: number | null;
  avgHr: number | null;
  isIndoor: boolean | null;
  isSpecial: boolean;
  elevationGainM: number | null;
  hasIntervals: boolean;
}

export interface TypeResult {
  type: SessionType;
  reason: string;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;
const fmtKm = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });

export function classifySessionTypes(runs: RunForType[], settings: TypeSettings = DEFAULT_TYPE_SETTINGS): Map<string, TypeResult> {
  const comparable = runs
    .filter((r) => !r.isIndoor && !r.hasIntervals && !r.isSpecial && r.avgPaceSPerKm !== null && r.distanceM !== null && r.distanceM >= 1000)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const baselineFor = (r: RunForType) => {
    const t = r.startAt.getTime();
    let pool = comparable.filter((c) => c.id !== r.id && c.startAt.getTime() < t && c.startAt.getTime() >= t - BASELINE_DAYS * 86_400_000);
    let scope = "12 meses";
    if (pool.length < MIN_BASELINE_RUNS) {
      pool = comparable.filter((c) => c.id !== r.id);
      scope = "historial";
    }
    if (pool.length < MIN_BASELINE_RUNS) return null;
    const hrs = pool.map((c) => c.avgHr).filter((h): h is number => h !== null);
    return {
      pace: median(pool.map((c) => c.avgPaceSPerKm!))!,
      hr: hrs.length >= 3 ? median(hrs) : null,
      scope,
    };
  };

  const out = new Map<string, TypeResult>();
  for (const r of runs) {
    const km = r.distanceM === null ? null : r.distanceM / 1000;
    if (r.hasIntervals) {
      out.set(r.id, { type: "series", reason: "El reloj registró intervalos" });
      continue;
    }
    if (r.isIndoor) {
      out.set(r.id, { type: "cinta", reason: "Entrenamiento indoor" });
      continue;
    }
    if (km !== null && km >= settings.longRunKm) {
      out.set(r.id, { type: "tirada_larga", reason: `${fmtKm(km)} km (≥ ${fmtKm(settings.longRunKm)} km)` });
      continue;
    }
    if (km !== null && km >= 1 && r.elevationGainM !== null && r.elevationGainM / km >= settings.trailMPerKm) {
      out.set(r.id, {
        type: "trail",
        reason: `${Math.round(r.elevationGainM / km)} m de desnivel por km (≥ ${settings.trailMPerKm})`,
      });
      continue;
    }
    const base = r.avgPaceSPerKm === null ? null : baselineFor(r);
    if (!base || r.avgPaceSPerKm === null) {
      out.set(r.id, { type: "rodaje", reason: "Sin media suficiente para comparar" });
      continue;
    }
    const diff = (r.avgPaceSPerKm - base.pace) / base.pace; // negativo = más rápido
    const useHr = r.avgHr !== null && base.hr !== null;
    const hrDiff = useHr ? r.avgHr! - base.hr! : 0;
    const hrText = useHr ? ` y FC ${hrDiff >= 0 ? "+" : "−"}${Math.round(Math.abs(hrDiff))} ppm` : "";
    const scope = `tu media (${base.scope})`;

    if (useHr ? diff <= -TEMPO_PACE && hrDiff >= TEMPO_HR : diff <= -TEMPO_PACE_NO_HR) {
      out.set(r.id, { type: "tempo", reason: `Ritmo ${pct(diff)} más rápido${hrText} que ${scope}` });
    } else if (useHr ? diff >= RECOV_PACE && hrDiff <= -RECOV_HR : diff >= RECOV_PACE_NO_HR) {
      out.set(r.id, { type: "recuperacion", reason: `Ritmo ${pct(diff)} más lento${hrText} que ${scope}` });
    } else {
      out.set(r.id, {
        type: "rodaje",
        reason: `Ritmo ${Math.abs(diff) < 0.005 ? "igual a" : `${pct(diff)} ${diff < 0 ? "más rápido que" : "más lento que"}`} ${scope}${hrText}`,
      });
    }
  }
  return out;
}
