/**
 * Volumen por periodo (semana, mes, año) y progreso de objetivos.
 *
 * - Fechas en hora de Madrid; la semana empieza el lunes.
 * - Km: todas las carreras válidas. Ritmo medio: tiempo/distancia SIN sesiones especiales
 *   (> 8:00 /km). FC media ponderada por tiempo. Desnivel, carga y zonas: sumas.
 * - Los periodos sin carreras aparecen con 0 (huecos visibles, nada inventado).
 */

export type PeriodUnit = "week" | "month" | "year";

export interface RunForPeriod {
  startAt: Date;
  distanceM: number | null;
  durationS: number;
  avgHr: number | null;
  isSpecial: boolean;
  elevationGainM: number | null;
  trainingLoad: number | null;
  hrZoneSeconds: number[] | null;
}

export interface Period {
  key: string;
  /** Primer día del periodo (AAAA-MM-DD, hora de Madrid). */
  start: string;
  label: string;
  current: boolean;
  km: number;
  runs: number;
  durationS: number;
  paceSPerKm: number | null;
  avgHr: number | null;
  elevationGainM: number | null;
  load: number | null;
  zoneSeconds: number[] | null;
}

const TZ = "Europe/Madrid";
const DAY = 86_400_000;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Día local (Madrid) como número de días desde 1970-01-01. */
export function localDay(d: Date): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY;
}

const ymd = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** Primer día (número de día local) del periodo que contiene `day`. */
export function periodStart(day: number, unit: PeriodUnit): number {
  const d = new Date(day * DAY);
  if (unit === "week") return day - ((d.getUTCDay() + 6) % 7); // lunes
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY;
  return Date.UTC(d.getUTCFullYear(), 0, 1) / DAY;
}

/** Inicio del periodo siguiente. */
export function nextStart(start: number, unit: PeriodUnit): number {
  const d = new Date(start * DAY);
  if (unit === "week") return start + 7;
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY;
  return Date.UTC(d.getUTCFullYear() + 1, 0, 1) / DAY;
}

function prevStart(start: number, unit: PeriodUnit): number {
  return periodStart(start - 1, unit);
}

function label(start: number, unit: PeriodUnit): string {
  const d = new Date(start * DAY);
  if (unit === "year") return String(d.getUTCFullYear());
  if (unit === "month") return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function aggregate(runs: RunForPeriod[]) {
  let km = 0,
    dur = 0,
    nsDist = 0,
    nsDur = 0,
    hrW = 0,
    hrT = 0,
    elev = 0,
    hasElev = false,
    load = 0,
    hasLoad = false;
  let zones: number[] | null = null;
  for (const r of runs) {
    const dist = r.distanceM ?? 0;
    km += dist / 1000;
    dur += r.durationS;
    if (!r.isSpecial && dist > 0) {
      nsDist += dist;
      nsDur += r.durationS;
    }
    if (r.avgHr !== null) {
      hrW += r.avgHr * r.durationS;
      hrT += r.durationS;
    }
    if (r.elevationGainM !== null) {
      elev += r.elevationGainM;
      hasElev = true;
    }
    if (r.trainingLoad !== null) {
      load += r.trainingLoad;
      hasLoad = true;
    }
    if (r.hrZoneSeconds) {
      zones ??= [0, 0, 0, 0, 0];
      r.hrZoneSeconds.forEach((s, i) => (zones![i] += s));
    }
  }
  return {
    km,
    runs: runs.length,
    durationS: dur,
    paceSPerKm: nsDist > 0 ? nsDur / (nsDist / 1000) : null,
    avgHr: hrT > 0 ? hrW / hrT : null,
    elevationGainM: hasElev ? elev : null,
    load: hasLoad ? load : null,
    zoneSeconds: zones,
  };
}

/** Los últimos `count` periodos hasta el actual (incluido), del más antiguo al más reciente. */
export function buildPeriods(runs: RunForPeriod[], unit: PeriodUnit, count: number, now: Date = new Date()): Period[] {
  const today = localDay(now);
  const currentStart = periodStart(today, unit);
  const starts: number[] = [currentStart];
  while (starts.length < count) starts.unshift(prevStart(starts[0], unit));
  const buckets = new Map<number, RunForPeriod[]>(starts.map((s) => [s, []]));
  for (const r of runs) {
    const s = periodStart(localDay(r.startAt), unit);
    buckets.get(s)?.push(r);
  }
  return starts.map((s) => ({
    key: `${unit}:${ymd(s)}`,
    start: ymd(s),
    label: label(s, unit),
    current: s === currentStart,
    ...aggregate(buckets.get(s)!),
  }));
}

/** Años desde la primera carrera hasta hoy. */
export function yearsSinceFirst(runs: RunForPeriod[], now: Date = new Date()): number {
  if (!runs.length) return 1;
  const first = Math.min(...runs.map((r) => r.startAt.getTime()));
  return new Date(now).getUTCFullYear() - new Date(first).getUTCFullYear() + 1;
}

export interface Comparison {
  current: Period;
  previous: Period;
  kmDelta: number;
  /** s/km (negativo = más rápido ahora); null si falta alguno. */
  paceDeltaS: number | null;
}

export function compareLast(periods: Period[]): Comparison | null {
  if (periods.length < 2) return null;
  const current = periods[periods.length - 1];
  const previous = periods[periods.length - 2];
  return {
    current,
    previous,
    kmDelta: current.km - previous.km,
    paceDeltaS: current.paceSPerKm !== null && previous.paceSPerKm !== null ? current.paceSPerKm - previous.paceSPerKm : null,
  };
}

// ─── Objetivos ───────────────────────────────────────────────────────────────

export interface Goal {
  km: number | null;
  paused: boolean;
}
export interface Goals {
  week: Goal;
  month: Goal;
  year: Goal;
}
export const EMPTY_GOALS: Goals = {
  week: { km: null, paused: false },
  month: { km: null, paused: false },
  year: { km: null, paused: false },
};

export interface GoalProgress {
  goalKm: number;
  doneKm: number;
  remainingKm: number;
  pct: number;
  /** Días que quedan, incluido hoy. */
  daysLeft: number;
  /** Km por día necesarios para llegar (0 si ya se cumplió). */
  kmPerDay: number;
}

export function goalProgress(goalKm: number, doneKm: number, unit: PeriodUnit, now: Date = new Date()): GoalProgress {
  const today = localDay(now);
  const daysLeft = nextStart(periodStart(today, unit), unit) - today;
  const remainingKm = Math.max(0, goalKm - doneKm);
  return {
    goalKm,
    doneKm,
    remainingKm,
    pct: goalKm > 0 ? Math.min(1, doneKm / goalKm) : 0,
    daysLeft,
    kmPerDay: remainingKm > 0 ? remainingKm / daysLeft : 0,
  };
}

/** Sugerencias a partir de los últimos 12 meses: media semanal, mensual y total anual. */
export function suggestGoals(runs: RunForPeriod[], now: Date = new Date()): { week: number; month: number; year: number } {
  const from = now.getTime() - 365 * DAY;
  const km = runs.filter((r) => r.startAt.getTime() >= from).reduce((a, r) => a + (r.distanceM ?? 0) / 1000, 0);
  return { week: Math.round(km / (365 / 7)), month: Math.round(km / 12), year: Math.round(km) };
}
