/**
 * Lógica de Inicio: recomendación provisional para hoy y la tira de la semana.
 *
 * La recomendación son reglas simples y prudentes con los datos que hay (no un plan): días desde
 * la última carrera, carga de la última frente a la media de 28 días y tipo de la última. Ante la
 * duda, se recomienda lo más suave. Siempre se presenta como estimación.
 */
import { localDay } from "./periods";
import { RATIO_BANDS, fmtRatio } from "./fitness";

export type TodayKind = "descanso" | "suave" | "calidad" | "libre";

export interface RunForToday {
  startAt: Date;
  distanceM: number | null;
  /** tipo efectivo (manual o automático) */
  type: string | null;
  trainingLoad: number | null;
}

export interface TodayAdvice {
  kind: TodayKind;
  label: string;
  /** motivo en una línea */
  reason: string;
}

export const TODAY_LABEL: Record<TodayKind, string> = {
  descanso: "Descanso",
  suave: "Rodaje suave",
  calidad: "Calidad",
  libre: "Libre",
};

/** Sesiones exigentes: el día siguiente, descanso o suave. */
export const HARD_TYPES = ["series", "tirada_larga", "competicion"] as const;
const QUALITY_TYPES = ["series", "tempo", "competicion"];
const TYPE_NAME: Record<string, string> = {
  series: "series",
  tirada_larga: "tirada larga",
  competicion: "competición",
  tempo: "tempo",
  rodaje: "rodaje",
  recuperacion: "recuperación",
  trail: "trail",
  cinta: "cinta",
};
/** Carga alta = la última carrera supera en un 50 % la media de 28 días. */
export const HIGH_LOAD_RATIO = 1.5;
/** Tras tantos días sin correr, se vuelve con suave. */
export const LONG_BREAK_DAYS = 10;

const km = (m: number | null) => (m === null ? "" : `${(m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`);
const daysTxt = (d: number) => (d === 1 ? "ayer" : `hace ${d} días`);

/** Estado de carga para «Hoy» (solo con 28 días de historial; si no, no se usa). */
export interface FitnessForToday {
  ratio: number | null;
  form: number;
  chronic: number;
  /** hay al menos 28 días de historial */
  enough: boolean;
}

/**
 * Recomendación: primero las reglas de siempre; después el ratio aguda/crónica las hace más
 * prudentes (nunca menos): ≥ 1,3 → como mucho suave (> 1,5 descanso solo si además hay dos días
 * seguidos corriendo; la lesión abierta ya manda descanso); «calidad» solo con ratio < 1,3.
 * Sin 28 días de historial no se usa el ratio y se dice.
 */
export function recommendToday(input: { runs: readonly RunForToday[]; openInjury: boolean; now?: Date; fitness?: FitnessForToday | null }): TodayAdvice {
  const base = baseAdvice(input);
  const f = input.fitness;
  if (!f || input.openInjury) return base;
  const mk = (kind: TodayKind, reason: string): TodayAdvice => ({ kind, label: TODAY_LABEL[kind], reason });
  if (!f.enough || f.ratio === null) {
    return base.kind === "descanso" ? base : { ...base, reason: `${base.reason} (Aún sin historial suficiente para el ratio de carga.)` };
  }
  const r = fmtRatio(f.ratio);
  if (f.ratio > RATIO_BANDS.risk) {
    // Con pocas carreras por semana el ratio se dispara con una sola semana buena: por sí solo
    // deja como mucho un rodaje suave; descanso por carga solo con dos días seguidos corriendo
    // (la lesión abierta ya manda descanso antes).
    const today = localDay(input.now ?? new Date());
    const ran = new Set(input.runs.map((x) => localDay(x.startAt)));
    if (ran.has(today - 1) && ran.has(today - 2)) {
      return base.kind === "descanso" ? { ...base, reason: `${base.reason} Además, carga muy alta: ratio ${r}.` } : mk("descanso", `Carga muy alta (ratio ${r}) y dos días seguidos corriendo: hoy, descanso.`);
    }
    if (base.kind === "descanso" || base.kind === "suave") return { ...base, reason: `${base.reason} Carga muy alta esta semana: ratio ${r}.` };
    return mk("suave", `Carga muy alta esta semana: ratio ${r}. Como mucho, un rodaje suave.`);
  }
  if (f.ratio >= RATIO_BANDS.high) {
    if (base.kind === "libre" || base.kind === "calidad") return mk("suave", `Carga alta esta semana: ratio ${r}. Mejor un rodaje suave.`);
    return { ...base, reason: `${base.reason} Carga alta esta semana: ratio ${r}.` };
  }
  if (base.kind === "calidad") return { ...base, reason: `${base.reason} Carga controlada: ratio ${r}.` };
  if (base.kind === "libre" && f.ratio < RATIO_BANDS.rested && f.form > 0) return { ...base, reason: `${base.reason} Vienes descansado: ratio ${r}.` };
  return base;
}

function baseAdvice(input: { runs: readonly RunForToday[]; openInjury: boolean; now?: Date }): TodayAdvice {
  const now = input.now ?? new Date();
  const today = localDay(now);
  const mk = (kind: TodayKind, reason: string): TodayAdvice => ({ kind, label: TODAY_LABEL[kind], reason });

  if (input.openInjury) return mk("descanso", "Tienes un periodo de lesión abierto: prioriza recuperar y no fuerces.");

  const runs = [...input.runs].filter((r) => localDay(r.startAt) <= today).sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  const last = runs[0];
  if (!last) return mk("libre", "Sin carreras recientes con las que estimar: elige según cómo te encuentres.");

  const days = today - localDay(last.startAt);
  const lastType = last.type ? (TYPE_NAME[last.type] ?? last.type) : "carrera";

  if (days === 0) return mk("descanso", `Hoy ya has corrido (${km(last.distanceM)}${last.type ? `, ${lastType}` : ""}): el resto del día, a recuperar.`);

  if (days >= LONG_BREAK_DAYS) return mk("suave", `Llevas ${days} días sin correr: vuelve con un rodaje suave antes de meter calidad.`);

  // Carga de la última frente a la media de las carreras de los 28 días anteriores a ella.
  const from = localDay(last.startAt) - 28;
  const prev = runs.slice(1).filter((r) => localDay(r.startAt) >= from && r.trainingLoad !== null);
  const avg = prev.length >= 3 ? prev.reduce((a, r) => a + r.trainingLoad!, 0) / prev.length : null;
  const ratio = last.trainingLoad !== null && avg ? last.trainingLoad / avg : null;
  const loadTxt = ratio !== null ? `carga ${Math.round(last.trainingLoad!)}, ${ratio.toFixed(1).replace(".", ",")}× tu media` : null;
  const hard = (HARD_TYPES as readonly string[]).includes(last.type ?? "");
  const highLoad = ratio !== null && ratio >= HIGH_LOAD_RATIO;

  // Tres días seguidos corriendo (hasta ayer): descanso.
  const ranOn = new Set(runs.map((r) => localDay(r.startAt)));
  if (days === 1 && ranOn.has(today - 1) && ranOn.has(today - 2) && ranOn.has(today - 3)) {
    return mk("descanso", "Has corrido tres días seguidos: un día de descanso ayuda a asimilarlos.");
  }

  if (days === 1) {
    if (last.type === "competicion") return mk("descanso", "Ayer compitiste: hoy, descanso.");
    if (hard && highLoad) return mk("descanso", `Ayer hiciste ${lastType} con carga alta (${loadTxt}).`);
    if (hard) return mk("suave", `Ayer hiciste ${lastType}: hoy, como mucho un rodaje suave.`);
    if (highLoad) return mk("suave", `Ayer la carga fue alta (${loadTxt}): mejor algo suave.`);
    return mk("libre", `Ayer hiciste ${lastType}${loadTxt ? ` (${loadTxt})` : ""}: hoy puedes elegir según cómo te encuentres.`);
  }

  if (days === 2 && (hard || highLoad)) {
    return mk("suave", `La última fue ${lastType} ${daysTxt(days)}${highLoad ? " con carga alta" : ""}: hoy, un rodaje suave.`);
  }

  // Descansado (≥ 2 días) y sin calidad en los últimos 4 días: se puede meter calidad.
  const recentQuality = runs.some((r) => today - localDay(r.startAt) <= 4 && QUALITY_TYPES.includes(r.type ?? ""));
  if (!recentQuality && !hard) return mk("calidad", `Última carrera ${daysTxt(days)} y sin sesiones de calidad en 4 días: buen día para una.`);

  return mk("libre", `Última carrera ${daysTxt(days)} (${lastType}): elige según cómo te encuentres.`);
}

// ─── Tira de la semana ─────────────────────────────────────────────────────────

export interface WeekDay {
  /** AAAA-MM-DD */
  date: string;
  /** L, M, X, J, V, S, D */
  letter: string;
  km: number;
  runs: number;
  state: "corrido" | "descanso" | "hoy" | "futuro";
  /** es hoy (aunque ya se haya corrido) */
  isToday: boolean;
}

const LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

/** Lunes a domingo de la semana actual (hora de Madrid): km por día y su estado. */
export function weekDays(runs: readonly { startAt: Date; distanceM: number | null }[], now: Date = new Date()): WeekDay[] {
  const today = localDay(now);
  const monday = today - ((new Date(today * 86_400_000).getUTCDay() + 6) % 7);
  return LETTERS.map((letter, i) => {
    const day = monday + i;
    const mine = runs.filter((r) => localDay(r.startAt) === day);
    const k = mine.reduce((a, r) => a + (r.distanceM ?? 0) / 1000, 0);
    const state: WeekDay["state"] = mine.length ? "corrido" : day === today ? "hoy" : day > today ? "futuro" : "descanso";
    return { date: new Date(day * 86_400_000).toISOString().slice(0, 10), letter, km: k, runs: mine.length, state, isToday: day === today };
  });
}
