/**
 * Carga de entrenamiento y forma (estilo ATL/CTL). Lógica pura, con pruebas.
 *
 * - Carga diaria: suma de la carga de las carreras del día (hora de Madrid); sin correr = 0.
 *   Una carrera sin dato de carga (sin pulso) no se inventa: el día queda marcado como
 *   incompleto y las cifras que lo incluyen, como estimadas (≈).
 * - Aguda (fatiga): media simple de los últimos 7 días (hoy incluido).
 * - Crónica (forma física): media ponderada exponencial de 28 días,
 *   c = c + α·(carga − c), α = 1 − e^(−1/28). Empieza en 0 el primer día con historial.
 * - Forma = crónica − aguda. Ratio = aguda / crónica (sin ratio si la crónica es casi 0).
 * - Aviso semanal: sube > 30 % sobre la anterior Y supera la media de las 8 semanas previas.
 * - Estados del ratio: < 0,8 Descansado · 0,8–1,3 En forma · 1,3–1,5 Cargado · > 1,5 Sobrecargado.
 * - Los periodos de lesión no se excluyen: su carga es real.
 */
import { localDay } from "./periods";

export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;
export const CHRONIC_ALPHA = 1 - Math.exp(-1 / CHRONIC_DAYS);
/** Por debajo de esta crónica (carga/día) el ratio no tiene sentido (dividir entre casi nada). */
export const MIN_CHRONIC = 5;
export const RATIO_BANDS = { rested: 0.8, high: 1.3, risk: 1.5 } as const;
/** Subida semanal que merece aviso. */
export const WEEKLY_RISE = 0.3;
export const AVG_WEEKS = 8;

export type LoadState = "descansado" | "en_forma" | "cargado" | "sobrecargado";
export const STATE_LABEL: Record<LoadState, string> = {
  descansado: "Descansado",
  en_forma: "En forma",
  cargado: "Cargado",
  sobrecargado: "Sobrecargado",
};

export interface LoadRun {
  id: string;
  startAt: Date;
  /** null = sin dato (sin pulso) */
  load: number | null;
  /** carga estimada con el pulso medio (≈) */
  estimated: boolean;
}

export interface DayLoad {
  /** número de día local (días desde 1970) */
  day: number;
  date: string;
  load: number;
  runs: string[];
  /** alguna carrera del día tiene carga estimada */
  estimated: boolean;
  /** carreras del día sin dato de carga */
  missing: number;
}

export interface FitnessPoint extends DayLoad {
  acute: number;
  chronic: number;
  form: number;
  ratio: number | null;
  state: LoadState | null;
  /** las cifras del día incluyen cargas estimadas o sin dato en sus 28 días, o falta historial */
  approx: boolean;
  /** menos de 28 días de historial hasta este día */
  warmup: boolean;
}

const ymd = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

export function loadState(ratio: number | null): LoadState | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio < RATIO_BANDS.rested) return "descansado";
  if (ratio < RATIO_BANDS.high) return "en_forma";
  if (ratio <= RATIO_BANDS.risk) return "cargado";
  return "sobrecargado";
}

/** Días seguidos desde el primero con carrera (o `fromDay`) hasta `toDay`, con su carga. */
export function dailyLoads(runs: readonly LoadRun[], toDay: number, fromDay?: number): DayLoad[] {
  const by = new Map<number, DayLoad>();
  let first = Infinity;
  for (const r of runs) {
    const d = localDay(r.startAt);
    if (d > toDay) continue;
    first = Math.min(first, d);
    const x = by.get(d) ?? { day: d, date: ymd(d), load: 0, runs: [], estimated: false, missing: 0 };
    x.runs.push(r.id);
    if (r.load === null) x.missing++;
    else {
      x.load += r.load;
      if (r.estimated) x.estimated = true;
    }
    by.set(d, x);
  }
  const start = fromDay ?? first;
  if (!Number.isFinite(start)) return [];
  const out: DayLoad[] = [];
  for (let d = start; d <= toDay; d++) out.push(by.get(d) ?? { day: d, date: ymd(d), load: 0, runs: [], estimated: false, missing: 0 });
  return out;
}

/** Aguda, crónica, forma, ratio y estado de cada día. */
export function fitnessSeries(days: readonly DayLoad[]): FitnessPoint[] {
  const out: FitnessPoint[] = [];
  let chronic = 0;
  let acuteSum = 0;
  // Días con carga estimada o sin dato dentro de la ventana de 28 días.
  let doubtful = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    chronic += CHRONIC_ALPHA * (d.load - chronic);
    acuteSum += d.load;
    if (i >= ACUTE_DAYS) acuteSum -= days[i - ACUTE_DAYS].load;
    const isDoubt = (x: DayLoad) => x.estimated || x.missing > 0;
    if (isDoubt(d)) doubtful++;
    if (i >= CHRONIC_DAYS && isDoubt(days[i - CHRONIC_DAYS])) doubtful--;
    const acute = acuteSum / ACUTE_DAYS;
    const ratio = chronic >= MIN_CHRONIC ? acute / chronic : null;
    const warmup = i + 1 < CHRONIC_DAYS;
    out.push({ ...d, acute, chronic, form: chronic - acute, ratio, state: loadState(ratio), approx: warmup || doubtful > 0, warmup });
  }
  return out;
}

export interface LoadCounts {
  measured: number;
  estimated: number;
  missing: number;
}

export function loadCounts(runs: readonly LoadRun[]): LoadCounts {
  const c = { measured: 0, estimated: 0, missing: 0 };
  for (const r of runs) {
    if (r.load === null) c.missing++;
    else if (r.estimated) c.estimated++;
    else c.measured++;
  }
  return c;
}

// ─── Carga semanal ─────────────────────────────────────────────────────────────

export interface WeekLoad {
  /** lunes, AAAA-MM-DD */
  start: string;
  startDay: number;
  load: number;
  approx: boolean;
  /** media de las 8 semanas anteriores (null si hay menos de 8) */
  avg8: number | null;
  /** carga con la que se compara: la semana anterior entera o, en la semana en curso, sus mismos días */
  prevLoad: number | null;
  /** subida respecto a prevLoad (0,35 = +35 %); el aviso exige además superar avg8 */
  rise: number | null;
  alert: boolean;
  /** semana en curso (sin terminar) */
  partial: boolean;
}

const mondayOf = (day: number) => day - ((new Date(day * 86_400_000).getUTCDay() + 6) % 7);

/** Semanas de lunes a domingo con su carga, media de las 8 anteriores y aviso de subida > 30 %. */
export function weeklyLoads(days: readonly DayLoad[], today: number): WeekLoad[] {
  if (!days.length) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const sum = (from: number, to: number) => {
    let load = 0;
    let approx = false;
    for (let d = from; d <= to; d++) {
      const x = byDay.get(d);
      if (!x) continue;
      load += x.load;
      if (x.estimated || x.missing > 0) approx = true;
    }
    return { load, approx };
  };
  const firstMon = mondayOf(days[0].day);
  const out: WeekLoad[] = [];
  for (let m = firstMon; m <= today; m += 7) {
    const partial = m + 6 > today;
    const w = sum(m, Math.min(m + 6, today));
    const prevFull = m - 7 >= firstMon ? sum(m - 7, m - 1).load : null;
    // En la semana en curso se compara con los mismos días de la anterior (sin avisos falsos a mitad de semana).
    const prevLoad = m - 7 < firstMon ? null : partial ? sum(m - 7, m - 7 + (today - m)).load : prevFull;
    const rise = prevLoad !== null && prevLoad > 0 ? Math.round((w.load / prevLoad - 1) * 1e6) / 1e6 : null;
    const prev8 = out.slice(-AVG_WEEKS);
    const avg8 = prev8.length === AVG_WEEKS ? prev8.reduce((a, x) => a + x.load, 0) / AVG_WEEKS : null;
    out.push({
      start: ymd(m),
      startDay: m,
      load: w.load,
      approx: w.approx,
      avg8,
      prevLoad,
      rise,
      // Con 2 carreras por semana, tras una semana floja casi cualquiera sube un 30 %: solo se
      // avisa si además supera la media de las 8 semanas previas.
      alert: rise !== null && rise > WEEKLY_RISE && avg8 !== null && w.load > avg8,
      partial,
    });
  }
  return out;
}

/** Texto corto con coma decimal. */
export const fmtRatio = (r: number) => r.toFixed(2).replace(".", ",");

// ─── Vista (Análisis e Inicio) ─────────────────────────────────────────────────

export interface FitnessRunIn extends LoadRun {
  distanceM: number | null;
  type: string | null;
}

export interface FitnessView {
  /** últimos 365 días (el selector 3/6/12 meses recorta en el cliente) */
  /** un valor por día, en columnas (viaja mucho más ligero que 365 objetos); ver viewPoints() */
  cols: FitnessCols;
  /** semanas de los últimos 12 meses */
  weeks: WeekLoad[];
  /** carreras de esos días, para la tarjeta del día tocado */
  runs: Record<string, { id: string; km: number | null; type: string | null; load: number | null; estimated: boolean }>;
  current: { state: LoadState | null; ratio: number | null; acute: number; chronic: number; form: number; approx: boolean; warmup: boolean } | null;
  /** días de historial hasta hoy */
  historyDays: number;
  /** recuento de cargas de las carreras de los últimos 12 meses */
  counts: LoadCounts;
  openInjury: boolean;
}

export const VIEW_DAYS = 365;

export function buildFitnessView(runs: readonly FitnessRunIn[], now: Date, openInjury: boolean): FitnessView {
  const today = localDay(now);
  const all = fitnessSeries(dailyLoads(runs, today));
  const from = today - VIEW_DAYS + 1;
  const shown = all.filter((p) => p.day >= from);
  const ids = new Set(shown.flatMap((p) => p.runs));
  const inView = runs.filter((r) => ids.has(r.id));
  const last = all.at(-1) ?? null;
  return {
    cols: toCols(shown),
    weeks: weeklyLoads(dailyLoads(runs, today), today).filter((w) => w.startDay + 6 >= from),
    runs: Object.fromEntries(
      inView.map((r) => [r.id, { id: r.id, km: r.distanceM === null ? null : r.distanceM / 1000, type: r.type, load: r.load, estimated: r.estimated }]),
    ),
    current: last
      ? { state: last.state, ratio: last.ratio, acute: last.acute, chronic: last.chronic, form: last.form, approx: last.approx, warmup: last.warmup }
      : null,
    historyDays: all.length,
    counts: loadCounts(inView),
    openInjury,
  };
}

export interface ViewPoint {
  date: string;
  load: number;
  acute: number;
  chronic: number;
  form: number;
  ratio: number | null;
  state: LoadState | null;
  approx: boolean;
  dayApprox: boolean;
  missing: number;
  runs: string[];
}

export interface FitnessCols {
  date: string[];
  load: number[];
  acute: number[];
  chronic: number[];
  ratio: (number | null)[];
  /** 0 = —, 1 aprox, 2 día con estimada o sin dato (bits) */
  flags: number[];
  missing: number[];
  runs: string[][];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function toCols(ps: readonly FitnessPoint[]): FitnessCols {
  return {
    date: ps.map((p) => p.date),
    load: ps.map((p) => Math.round(p.load)),
    acute: ps.map((p) => r2(p.acute)),
    chronic: ps.map((p) => r2(p.chronic)),
    ratio: ps.map((p) => (p.ratio === null ? null : r2(p.ratio))),
    flags: ps.map((p) => (p.approx ? 1 : 0) | (p.estimated || p.missing > 0 ? 2 : 0)),
    missing: ps.map((p) => p.missing),
    runs: ps.map((p) => p.runs),
  };
}

/** Vuelve a montar los puntos (en el cliente). Forma y estado se recalculan de aguda y crónica. */
export function viewPoints(c: FitnessCols): ViewPoint[] {
  return c.date.map((date, i) => ({
    date,
    load: c.load[i],
    acute: c.acute[i],
    chronic: c.chronic[i],
    form: r2(c.chronic[i] - c.acute[i]),
    ratio: c.ratio[i],
    state: loadState(c.ratio[i]),
    approx: (c.flags[i] & 1) === 1,
    dayApprox: (c.flags[i] & 2) === 2,
    missing: c.missing[i],
    runs: c.runs[i],
  }));
}
