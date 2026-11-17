/**
 * Cálculos de Análisis: media móvil, evolución del ritmo, calendario de constancia y
 * comparación de años. Fechas en hora de Madrid. Nada se rellena: días o periodos sin
 * carreras quedan vacíos.
 */
import { localDay } from "./periods";

const DAY = 86_400_000;
const ymd = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/**
 * Media móvil «hacia atrás» de `window` valores (incluido el actual). Hasta tener la
 * ventana completa devuelve null: no se inventa un promedio con menos datos.
 */
export function movingAverage(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k++) sum += values[k];
    return sum / window;
  });
}

// ─── Evolución del ritmo ─────────────────────────────────────────────────────

export interface RunForPace {
  id: string;
  startAt: Date;
  distanceM: number | null;
  durationS: number;
  avgPaceSPerKm: number | null;
  avgHr: number | null;
  isSpecial: boolean;
  type: string | null;
  inInjury?: boolean;
}

export type PaceRange = "1m" | "3m" | "6m" | "1y" | "all";
export const RANGE_DAYS: Record<PaceRange, number | null> = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: null };

export interface PacePoint {
  id: string;
  t: number; // ms
  pace: number; // s/km
  km: number;
  avgHr: number | null;
  type: string | null;
  inInjury: boolean;
}

/** Una carrera = un punto. Excluye especiales y carreras sin ritmo; filtra por rango y tipo. */
export function pacePoints(runs: RunForPace[], range: PaceRange, type: string | null, now: Date = new Date()): PacePoint[] {
  const days = RANGE_DAYS[range];
  const from = days === null ? -Infinity : now.getTime() - days * DAY;
  return runs
    .filter((r) => !r.isSpecial && r.avgPaceSPerKm !== null && r.distanceM !== null && r.distanceM > 0)
    .filter((r) => r.startAt.getTime() >= from && r.startAt.getTime() <= now.getTime())
    .filter((r) => !type || r.type === type)
    .map((r) => ({
      id: r.id,
      t: r.startAt.getTime(),
      pace: r.avgPaceSPerKm!,
      km: r.distanceM! / 1000,
      avgHr: r.avgHr,
      type: r.type,
      inInjury: r.inInjury ?? false,
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Tendencia suavizada: media ponderada con núcleo gaussiano en el tiempo, evaluada en cada
 * punto. Ancho de banda = 1/6 del intervalo de fechas (mínimo 5 días). Con menos de 3
 * puntos no hay tendencia.
 */
export function smoothTrend(points: PacePoint[]): { t: number; pace: number }[] {
  if (points.length < 3) return [];
  const span = points[points.length - 1].t - points[0].t;
  const bw = Math.max(5 * DAY, span / 6);
  return points.map((p) => {
    let w = 0,
      s = 0;
    for (const q of points) {
      const k = Math.exp(-0.5 * ((q.t - p.t) / bw) ** 2);
      w += k;
      s += k * q.pace;
    }
    return { t: p.t, pace: s / w };
  });
}

// ─── Calendario de constancia ────────────────────────────────────────────────

export interface RunForDay {
  id: string;
  startAt: Date;
  distanceM: number | null;
  durationS: number;
  trainingLoad: number | null;
  type: string | null;
}

export interface CalendarDay {
  date: string; // AAAA-MM-DD
  /** 0 = lunes … 6 = domingo */
  weekday: number;
  km: number;
  load: number | null;
  runs: { id: string; km: number; durationS: number; type: string | null; load: number | null }[];
}

/** Un día por casilla desde el lunes de hace ~12 meses hasta hoy (columnas = semanas). */
export function calendarDays(runs: RunForDay[], now: Date = new Date(), days = 365): CalendarDay[] {
  const today = localDay(now);
  let start = today - days + 1;
  start -= (new Date(start * DAY).getUTCDay() + 6) % 7; // empieza en lunes
  const map = new Map<number, CalendarDay>();
  for (let d = start; d <= today; d++) {
    map.set(d, { date: ymd(d), weekday: (new Date(d * DAY).getUTCDay() + 6) % 7, km: 0, load: null, runs: [] });
  }
  for (const r of runs) {
    const c = map.get(localDay(r.startAt));
    if (!c) continue;
    const km = (r.distanceM ?? 0) / 1000;
    c.km += km;
    if (r.trainingLoad !== null) c.load = (c.load ?? 0) + r.trainingLoad;
    c.runs.push({ id: r.id, km, durationS: r.durationS, type: r.type, load: r.trainingLoad });
  }
  return [...map.values()];
}

/** Nivel 0…4 para la intensidad (0 = sin correr). Cortes por cuartiles de los días con valor. */
export function intensityLevels(values: (number | null)[]): number[] {
  const vs = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (!vs.length) return values.map(() => 0);
  const q = (p: number) => vs[Math.min(vs.length - 1, Math.floor(p * vs.length))];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return values.map((v) => (v === null || v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4));
}

// ─── Comparación de años ─────────────────────────────────────────────────────

export interface RunForYear {
  startAt: Date;
  distanceM: number | null;
  durationS: number;
  elevationGainM: number | null;
  isSpecial: boolean;
}

/** Km acumulados por día del año (0 = 1 de enero). `untilDoy` corta la serie (año actual). */
export function cumulativeByDay(runs: RunForYear[], year: number, untilDoy?: number): number[] {
  const jan1 = Date.UTC(year, 0, 1) / DAY;
  const len = untilDoy ?? Date.UTC(year + 1, 0, 1) / DAY - jan1 - 1;
  const daily = new Array<number>(len + 1).fill(0);
  for (const r of runs) {
    const doy = localDay(r.startAt) - jan1;
    if (doy >= 0 && doy <= len) daily[doy] += (r.distanceM ?? 0) / 1000;
  }
  let acc = 0;
  return daily.map((k) => (acc += k));
}

export interface YearTotals {
  km: number;
  hours: number;
  elevationGainM: number | null;
  runs: number;
  paceSPerKm: number | null;
}

/** Totales del 1 de enero hasta el día del año `doy` (incluido). Ritmo sin especiales. */
export function totalsToDoy(runs: RunForYear[], year: number, doy: number): YearTotals {
  const jan1 = Date.UTC(year, 0, 1) / DAY;
  const sel = runs.filter((r) => {
    const d = localDay(r.startAt) - jan1;
    return d >= 0 && d <= doy;
  });
  const dist = sel.reduce((a, r) => a + (r.distanceM ?? 0), 0);
  const ns = sel.filter((r) => !r.isSpecial && (r.distanceM ?? 0) > 0);
  const nsDist = ns.reduce((a, r) => a + r.distanceM!, 0);
  const nsDur = ns.reduce((a, r) => a + r.durationS, 0);
  const elev = sel.filter((r) => r.elevationGainM !== null);
  return {
    km: dist / 1000,
    hours: sel.reduce((a, r) => a + r.durationS, 0) / 3600,
    elevationGainM: elev.length ? elev.reduce((a, r) => a + r.elevationGainM!, 0) : null,
    runs: sel.length,
    paceSPerKm: nsDist > 0 ? nsDur / (nsDist / 1000) : null,
  };
}

/** Año actual hasta hoy frente al año anterior hasta el mismo día del año. */
export function yearToDate(runs: RunForYear[], now: Date = new Date()) {
  const today = localDay(now);
  const year = new Date(today * DAY).getUTCFullYear();
  const doy = today - Date.UTC(year, 0, 1) / DAY;
  // Mismo día del año (29-feb → 28-feb si el año anterior no es bisiesto).
  const prevLen = Date.UTC(year, 0, 1) / DAY - Date.UTC(year - 1, 0, 1) / DAY;
  const prevDoy = Math.min(doy, prevLen - 1);
  return {
    year,
    doy,
    current: totalsToDoy(runs, year, doy),
    previous: totalsToDoy(runs, year - 1, prevDoy),
    currentCum: cumulativeByDay(runs, year, doy),
    previousCum: cumulativeByDay(runs, year - 1),
  };
}
