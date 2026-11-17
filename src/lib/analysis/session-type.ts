/**
 * Tipos de sesión y clasificación automática por reglas simples.
 * Orden de las reglas (la primera que se cumple gana):
 *   1. Series        → el reloj marcó intervalos de verdad (ver isIntervalWorkout)
 *   2. Cinta         → entrenamiento indoor
 *   3. Tirada larga  → distancia ≥ longRunKm (15 km por defecto)
 *   4. Trail         → desnivel positivo ≥ trailMPerKm metros por km
 *   5. Con pulso, por la zona del pulso medio: Z1 → Recuperación; Z2 → Rodaje;
 *      Z3 o más → Tempo si el ritmo es ≥ 4 % más rápido que tu media de los 12 meses
 *      anteriores (carreras comparables: sin cinta, series ni especiales); si no, Rodaje.
 *      Sin pulso, solo el ritmo frente a tu media (≥ 7 % más rápido → Tempo,
 *      ≥ 10 % más lento → Recuperación, si no Rodaje).
 * Competición nunca se adivina: solo a mano.
 */

import { DEFAULT_ZONES, zoneOf, type HrZones } from "./hr-zones";

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
 * Colores: variables CSS con una paleta categórica validada para cada tema (noche sobre
 * #151712, día sobre #FFFFFF; orden fijo, nunca se cicla). Ver globals.css.
 * Cada tipo lleva además icono y nombre: el color nunca va solo.
 */
export const TYPE_META: Record<SessionType, { label: string; color: string }> = {
  rodaje: { label: "Rodaje", color: "var(--t-rodaje)" },
  tirada_larga: { label: "Tirada larga", color: "var(--t-tirada_larga)" },
  series: { label: "Series", color: "var(--t-series)" },
  tempo: { label: "Tempo", color: "var(--t-tempo)" },
  recuperacion: { label: "Recuperación", color: "var(--t-recuperacion)" },
  competicion: { label: "Competición", color: "var(--t-competicion)" },
  trail: { label: "Trail", color: "var(--t-trail)" },
  cinta: { label: "Cinta", color: "var(--t-cinta)" },
};

export interface TypeSettings {
  longRunKm: number;
  trailMPerKm: number;
}
export const DEFAULT_TYPE_SETTINGS: TypeSettings = { longRunKm: 13, trailMPerKm: 25 };

/**
 * Series de verdad: 5 o más rutas de paso distintas y alguna con repetición
 * (2.º o 3.º componente distinto de 0, p. ej. "1.0.1" o "1.1.0"). Un rodaje
 * normal del Apple Watch solo trae "0.0.0".
 */
export const MIN_INTERVAL_STEPS = 5;
export function isIntervalWorkout(steps: readonly string[] | null | undefined): boolean {
  if (!steps) return false;
  const distinct = new Set(steps);
  if (distinct.size < MIN_INTERVAL_STEPS) return false;
  return [...distinct].some((p) => {
    const [, b, c] = p.split(".").map(Number);
    return (Number.isFinite(b) && b !== 0) || (Number.isFinite(c) && c !== 0);
  });
}

/** Umbrales de ritmo frente a tu media (fijos y explicados en el motivo). */
const TEMPO_PACE = 0.04; // Tempo: Z3 o más y ≥ 4 % más rápido que tu media
const TEMPO_PACE_NO_HR = 0.07; // sin pulso: ≥ 7 % más rápido
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
  /** Rutas de paso distintas (WOIntervalStepKeyPath); null si la importación no las guardó. */
  intervalSteps: string[] | null;
  /** En periodo de lesión: no entra en la media de referencia. */
  inInjury?: boolean;
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

export function classifySessionTypes(
  runs: RunForType[],
  settings: TypeSettings = DEFAULT_TYPE_SETTINGS,
  zones: HrZones | null = DEFAULT_ZONES,
): Map<string, TypeResult> {
  const comparable = runs
    .filter((r) => !r.isIndoor && !r.inInjury && !isIntervalWorkout(r.intervalSteps) && !r.isSpecial && r.avgPaceSPerKm !== null && r.distanceM !== null && r.distanceM >= 1000)
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
    if (isIntervalWorkout(r.intervalSteps)) {
      out.set(r.id, { type: "series", reason: `Intervalos del reloj: ${new Set(r.intervalSteps).size} pasos con repeticiones` });
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
    const diff = base && r.avgPaceSPerKm !== null ? (r.avgPaceSPerKm - base.pace) / base.pace : null; // < 0 = más rápido
    const scope = base ? `tu media (${base.scope})` : "";

    // Con pulso y zonas: la zona del pulso medio decide.
    if (zones && r.avgHr !== null) {
      const z = zoneOf(r.avgHr, zones.limits);
      const hrText = `FC media ${Math.round(r.avgHr)} ppm en Z${z}`;
      if (z === 1) out.set(r.id, { type: "recuperacion", reason: hrText });
      else if (z === 2) out.set(r.id, { type: "rodaje", reason: hrText });
      else if (diff !== null && diff <= -TEMPO_PACE)
        out.set(r.id, { type: "tempo", reason: `${hrText} y ritmo ${pct(diff)} más rápido que ${scope}` });
      else
        out.set(r.id, {
          type: "rodaje",
          reason: diff === null ? `${hrText}; sin media para comparar el ritmo` : `${hrText}, ritmo no claramente más rápido que ${scope}`,
        });
      continue;
    }

    // Sin pulso: solo el ritmo frente a tu media, con umbrales más exigentes.
    if (diff === null) {
      out.set(r.id, { type: "rodaje", reason: "Sin pulso ni media suficiente para comparar" });
    } else if (diff <= -TEMPO_PACE_NO_HR) {
      out.set(r.id, { type: "tempo", reason: `Sin pulso: ritmo ${pct(diff)} más rápido que ${scope}` });
    } else if (diff >= RECOV_PACE_NO_HR) {
      out.set(r.id, { type: "recuperacion", reason: `Sin pulso: ritmo ${pct(diff)} más lento que ${scope}` });
    } else {
      out.set(r.id, { type: "rodaje", reason: `Sin pulso: ritmo cercano a ${scope}` });
    }
  }
  return out;
}
