/**
 * «Resumen de la semana» (lunes a domingo): cifras y de 1 a 5 frases con reglas, sin IA. Lógica
 * pura, con pruebas.
 *
 * - Solo se afirma lo que hay: sin carreras no se habla de ritmo ni de la más larga; sin objetivo,
 *   nada del objetivo; sin semanas anteriores suficientes, no se compara; sin plan, no hay
 *   «previsto frente a realizado».
 * - Nada de causas ni alertas: el volumen se compara con la media de las 8 semanas anteriores sin
 *   avisos por subidas (acordado); «coincidió con» para la lesión.
 * - Previsto frente a realizado usa el cumplimiento por semana (una carrera de la semana cubre la
 *   sesión de su tipo aunque sea otro día; lo vinculado a mano manda).
 * - Sin notificaciones: solo se ve al abrirlo.
 */
import { addDaysYmd } from "./week-dates";

export const WEEK_RULES = {
  /** semanas anteriores para la media de volumen */
  prevWeeks: 8,
  /** con menos semanas anteriores con datos, no se compara */
  minPrevWeeks: 2,
  /** dentro de ±10 % de la media: «parecido» */
  similarPct: 0.1,
  /** sensaciones: media solo con al menos 2 valoradas */
  minRated: 2,
  maxLines: 5,
} as const;

export type Tone = "good" | "watch" | "neutral";
export interface WeekLine {
  text: string;
  tone: Tone;
}

export interface WeekRun {
  id: string;
  /** día (Madrid) */
  date: string;
  distanceM: number | null;
  durationS: number;
  /** tipo efectivo */
  type: string | null;
  typeLabel: string;
  load: number | null;
  /** valoración de 1 a 5 (sensaciones), si la hay */
  rating: number | null;
}

/** Estado de una sesión prevista (mía o la sugerida) según el cumplimiento por semana. */
export type PlanState = "cumplida" | "otra" | "pendiente" | "dia_pasado" | "no_hecha" | "no_cumplida" | "opcional" | "descanso";

export interface WeekPlanItem {
  label: string;
  mine: boolean;
  day: string;
  status: PlanState;
  /** «Hecha antes (martes 24)» si la cubrió una carrera de otro día */
  doneWhen?: string | null;
  /** vínculo puesto a mano */
  manual?: boolean;
  /** carrera que la cubre */
  runId?: string | null;
}

export interface WeekInput {
  /** lunes */
  start: string;
  today: string;
  runs: readonly WeekRun[];
  /** km de las semanas anteriores (la más reciente primero; hasta 8) */
  prevKm: readonly number[];
  goalKm: number | null;
  plan: readonly WeekPlanItem[];
  /** carreras que no cubren ninguna sesión prevista */
  unplanned: number;
  /** algún día de la semana con lesión abierta */
  injury: boolean;
}

export interface WeekSummary {
  start: string;
  end: string;
  inProgress: boolean;
  /** días que quedan (incluido hoy) si la semana está en curso */
  daysLeft: number;
  km: number;
  runs: number;
  timeS: number;
  /** carga de las carreras con dato y cuántas la tienen */
  load: number | null;
  loadRuns: number;
  longest: { km: number; date: string; typeLabel: string } | null;
  /** km por tipo, de más a menos */
  byType: { type: string | null; label: string; km: number }[];
  /** km por día (lunes a domingo) */
  daily: number[];
  avgKm: number | null;
  goal: { target: number; done: number; pct: number } | null;
  plan: { total: number; done: number; otherDay: number; other: number; missed: number; pending: number; manual: number };
  unplanned: number;
  rating: { avg: number; n: number } | null;
  lines: WeekLine[];
}

const WD = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const dayLabel = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${WD[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`;
};
const km1 = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const fmtTime = (s: number) => {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")} min` : ""}` : `${m} min`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarizeWeek(i: WeekInput): WeekSummary {
  const R = WEEK_RULES;
  const end = addDaysYmd(i.start, 6);
  const inProgress = i.today >= i.start && i.today <= end;
  const daysLeft = inProgress ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${i.today}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  const runs = i.runs.filter((r) => r.date >= i.start && r.date <= end);
  const km = runs.reduce((a, r) => a + (r.distanceM ?? 0), 0) / 1000;
  const timeS = runs.reduce((a, r) => a + r.durationS, 0);
  const withLoad = runs.filter((r) => r.load !== null);
  const longestRun = runs.filter((r) => r.distanceM).sort((a, b) => b.distanceM! - a.distanceM!)[0];
  const types = new Map<string, { type: string | null; label: string; km: number }>();
  for (const r of runs) {
    const k = r.type ?? "";
    const t = types.get(k) ?? { type: r.type, label: r.typeLabel, km: 0 };
    t.km += (r.distanceM ?? 0) / 1000;
    types.set(k, t);
  }
  const daily = Array.from({ length: 7 }, (_, d) => runs.filter((r) => r.date === addDaysYmd(i.start, d)).reduce((a, r) => a + (r.distanceM ?? 0), 0) / 1000);
  const prev = i.prevKm.slice(0, R.prevWeeks);
  const avgKm = prev.filter((x) => x > 0).length >= R.minPrevWeeks ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
  const goal = i.goalKm ? { target: i.goalKm, done: km, pct: km / i.goalKm } : null;

  // Previsto frente a realizado (descansos y opcionales sin correr no cuentan).
  const counted = i.plan.filter((p) => p.status !== "descanso" && p.status !== "opcional");
  const plan = {
    total: counted.length,
    done: counted.filter((p) => p.status === "cumplida").length,
    otherDay: counted.filter((p) => (p.status === "cumplida" || p.status === "otra") && p.doneWhen).length,
    other: counted.filter((p) => p.status === "otra").length,
    missed: counted.filter((p) => p.status === "no_hecha" || p.status === "no_cumplida" || (!inProgress && p.status === "dia_pasado")).length,
    pending: counted.filter((p) => p.status === "pendiente" || (inProgress && p.status === "dia_pasado")).length,
    manual: counted.filter((p) => p.manual).length,
  };
  const rated = runs.filter((r) => r.rating !== null);
  const rating = rated.length >= R.minRated ? { avg: rated.reduce((a, r) => a + r.rating!, 0) / rated.length, n: rated.length } : null;

  const lines: (WeekLine & { prio: number })[] = [];
  const add = (prio: number, text: string, tone: Tone) => lines.push({ prio, text, tone });

  // 0) Volumen.
  if (!runs.length) add(0, inProgress ? "Esta semana aún no has corrido." : "Semana sin carreras.", "neutral");
  else add(0, `${inProgress ? "Llevas" : "Semana de"} ${km1(km)} km en ${plural(runs.length, "carrera", "carreras")} (${fmtTime(timeS)}).`, "neutral");

  // 1) Previsto frente a realizado.
  if (plan.total) {
    const extra = plan.otherDay ? (plan.total === 1 ? " (en otro día de la semana)" : ` (${plan.otherDay} en otro día de la semana)`) : "";
    if (plan.done === plan.total) add(1, `Previsto frente a realizado: ${plan.total === 1 ? "cumpliste la sesión prevista" : `cumpliste las ${plan.total} sesiones previstas`}${extra}.`, "good");
    else {
      const parts = [`${plan.done} de ${plan.total} cumplidas${extra}`];
      if (plan.other) parts.push(`${plural(plan.other, "hecha", "hechas")} con otro tipo`);
      if (plan.missed) parts.push(`${plural(plan.missed, "sin hacer", "sin hacer")}`);
      if (plan.pending) parts.push(`${plural(plan.pending, "pendiente", "pendientes")}`);
      add(1, `Previsto frente a realizado: ${parts.join("; ")}.`, plan.missed ? "watch" : "neutral");
    }
  }

  // 2) Objetivo semanal.
  if (goal) {
    if (km >= goal.target) add(2, `Objetivo semanal cumplido: ${km1(km)} de ${km1(goal.target)} km.`, "good");
    else if (inProgress) add(2, `Llevas ${km1(km)} de ${km1(goal.target)} km del objetivo; ${daysLeft === 1 ? "queda hoy" : `quedan ${daysLeft} días`}.`, "neutral");
    else add(2, `Faltaron ${km1(goal.target - km)} km para el objetivo (${km1(km)} de ${km1(goal.target)}).`, "neutral");
  }

  // 3) Frente a la media de las semanas anteriores (solo semanas cerradas; sin alertas).
  if (!inProgress && avgKm !== null && avgKm > 0) {
    const rel = km / avgKm - 1;
    const n = prev.length;
    if (Math.abs(rel) < R.similarPct) add(3, `Volumen parecido a la media de tus ${n} semanas anteriores (${km1(avgKm)} km).`, "neutral");
    else add(3, `Volumen un ${Math.round(Math.abs(rel) * 100)} % ${rel > 0 ? "por encima" : "por debajo"} de la media de tus ${n} semanas anteriores (${km1(avgKm)} km).`, "neutral");
  }

  // 4) La más larga.
  if (longestRun && runs.length > 1) add(4, `La más larga: ${km1(longestRun.distanceM! / 1000)} km (${longestRun.typeLabel}, ${dayLabel(longestRun.date)}).`, "neutral");

  // 5) Sensaciones.
  if (rating) add(5, `Sensaciones: media de ${km1(rating.avg)} sobre 5 en ${rating.n} carreras valoradas.`, rating.avg >= 4 ? "good" : rating.avg <= 2 ? "watch" : "neutral");

  // 6) No previstas.
  if (i.unplanned && plan.total) add(6, `${plural(i.unplanned, "carrera no prevista", "carreras no previstas")}.`, "neutral");

  // 7) Lesión (coincidencia).
  if (i.injury) add(7, "Coincidió con un periodo de lesión.", "neutral");

  return {
    start: i.start,
    end,
    inProgress,
    daysLeft,
    km,
    runs: runs.length,
    timeS,
    load: withLoad.length ? withLoad.reduce((a, r) => a + r.load!, 0) : null,
    loadRuns: withLoad.length,
    longest: longestRun ? { km: longestRun.distanceM! / 1000, date: longestRun.date, typeLabel: longestRun.typeLabel } : null,
    byType: [...types.values()].sort((a, b) => b.km - a.km),
    daily,
    avgKm,
    goal,
    plan,
    unplanned: i.unplanned,
    rating,
    lines: lines
      .sort((a, b) => a.prio - b.prio)
      .slice(0, R.maxLines)
      .map(({ text, tone }) => ({ text, tone })),
  };
}
