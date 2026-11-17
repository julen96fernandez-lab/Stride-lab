/**
 * Volumen por periodo (semana, mes, año) y progreso de objetivos.
 *
 * - Fechas en hora de Madrid; la semana empieza el lunes.
 * - Km: todas las carreras válidas. Ritmo medio: tiempo/distancia SIN sesiones especiales
 *   (> 8:00 /km) ni carreras en periodo de lesión. FC media ponderada por tiempo. Desnivel, carga y zonas: sumas.
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
  /** Tipo de sesión efectivo (manual o automático); opcional. */
  type?: string | null;
  /** En periodo de lesión: suma km, no cuenta en el ritmo medio. */
  inInjury?: boolean;
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
  /** Km por tipo de sesión (los tipos sin km no aparecen; sin tipo → "sin_tipo"). */
  kmByType: Record<string, number>;
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
  const kmByType: Record<string, number> = {};
  for (const r of runs) {
    const dist = r.distanceM ?? 0;
    km += dist / 1000;
    if (dist > 0) {
      const t = r.type ?? "sin_tipo";
      kmByType[t] = (kmByType[t] ?? 0) + dist / 1000;
    }
    dur += r.durationS;
    if (!r.isSpecial && !r.inInjury && dist > 0) {
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
    kmByType,
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

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** «1–18 oct», «9–11 nov», «30 oct – 2 nov» o «1 ene – 18 nov 2025» (años distintos o rango anual). */
export function rangeLabel(from: string, to: string, withYear = false): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const yr = withYear ? ` ${ty}` : "";
  if (from === to) return `${fd} ${MES_CORTO[fm - 1]}${yr}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MES_CORTO[tm - 1]}${yr}`;
  return `${fd} ${MES_CORTO[fm - 1]} – ${td} ${MES_CORTO[tm - 1]}${yr}`;
}

export interface StretchComparison extends Comparison {
  /** Rangos comparados (AAAA-MM-DD, ambos incluidos): el periodo actual hasta hoy y el mismo tramo del anterior. */
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  /** true si el periodo anterior es más corto que lo transcurrido (p. ej. 31 mar frente a febrero) y se comparó entero. */
  capped: boolean;
}

/**
 * Periodo actual hasta hoy frente al **mismo tramo** del periodo anterior: los mismos días desde
 * el inicio (lunes→hoy frente a lunes→mismo día de la semana pasada; 1→hoy del mes o del año
 * frente a 1→mismo día del anterior). No se compara con el periodo anterior entero.
 */
export function comparePeriodToDate(runs: RunForPeriod[], unit: PeriodUnit, now: Date = new Date()): StretchComparison {
  const today = localDay(now);
  const curStart = periodStart(today, unit);
  const prevFrom = prevStart(curStart, unit);
  const elapsed = today - curStart; // días ya transcurridos (0 = primer día)
  const prevLen = curStart - prevFrom;
  const capped = elapsed > prevLen - 1;
  const prevTo = prevFrom + Math.min(elapsed, prevLen - 1);
  const within = (from: number, to: number) =>
    runs.filter((r) => {
      const d = localDay(r.startAt);
      return d >= from && d <= to;
    });
  const mk = (from: number, to: number, current: boolean): Period => ({
    key: `${unit}:${ymd(from)}`,
    start: ymd(from),
    label: label(from, unit),
    current,
    ...aggregate(within(from, to)),
  });
  const current = mk(curStart, today, true);
  const previous = mk(prevFrom, prevTo, false);
  return {
    current,
    previous,
    kmDelta: current.km - previous.km,
    paceDeltaS: current.paceSPerKm !== null && previous.paceSPerKm !== null ? current.paceSPerKm - previous.paceSPerKm : null,
    currentFrom: ymd(curStart),
    currentTo: ymd(today),
    previousFrom: ymd(prevFrom),
    previousTo: ymd(prevTo),
    capped,
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
