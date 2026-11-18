/**
 * Predicción de marcas (5K, 10K, media y maratón) a partir de los mejores esfuerzos recientes.
 * Lógica pura, con pruebas. Es una ESTIMACIÓN: los esfuerzos son los mejores tramos de
 * entrenamientos (no carreras a tope), así que la marca real en una carrera puede ser mejor.
 *
 * - Fuentes: por cada distancia de esfuerzo (milla, 5K, 10K, media, maratón), el mejor esfuerzo
 *   de los últimos 3 meses; si no hay, de los últimos 6; si no, de los últimos 12.
 * - Riegel: T = t · (D/d)^k. Valor central con k = 1,06; rango con k entre 1,04 y 1,10 en todas
 *   las fuentes. Solo se extrapola hasta ×4,3 de distancia (en ambos sentidos).
 * - Cada fuente pesa por antigüedad (≤ 3 meses 1; ≤ 6 meses 0,6; ≤ 12 meses 0,3) y por cercanía de
 *   distancia (1 / (1 + 1,5·|ln(D/d)|)).
 * - Confianza: alta con ≥ 2 fuentes de ≤ 3 meses y una de distancia parecida (≤ ×1,5); media con
 *   alguna fuente de ≤ 6 meses a menos de ×2,2; baja en el resto.
 * - Sin fuentes válidas, la distancia no se muestra. El maratón, además, solo con una tirada de
 *   30 km o más en los últimos 12 meses.
 */
export type TargetKey = "5k" | "10k" | "half" | "marathon";
export type SourceKey = "1mi" | "5k" | "10k" | "half" | "marathon";
export type Confidence = "alta" | "media" | "baja";

export const TARGETS: { key: TargetKey; label: string; m: number }[] = [
  { key: "5k", label: "5 km", m: 5000 },
  { key: "10k", label: "10 km", m: 10000 },
  { key: "half", label: "Media maratón", m: 21097.5 },
  { key: "marathon", label: "Maratón", m: 42195 },
];
export const SOURCE_M: Record<SourceKey, number> = { "1mi": 1609.344, "5k": 5000, "10k": 10000, half: 21097.5, marathon: 42195 };
export const SOURCE_LABEL: Record<SourceKey, string> = { "1mi": "1 milla", "5k": "5 km", "10k": "10 km", half: "media", marathon: "maratón" };

export const K_CENTRAL = 1.06;
export const K_RANGE: [number, number] = [1.04, 1.1];
export const MAX_RATIO = 4.3;
export const CLOSE_RATIO = 2.2;
/** Para confianza alta hace falta un esfuerzo reciente de distancia parecida (a menos de ×1,5). */
export const SAME_RATIO = 1.5;
export const MARATHON_MIN_RUN_M = 30_000;
const DAY = 86_400_000;
const WINDOWS = [91, 182, 365] as const;
const AGE_WEIGHT: Record<(typeof WINDOWS)[number], number> = { 91: 1, 182: 0.6, 365: 0.3 };

export interface EffortIn {
  key: string;
  timeS: number;
  /** inicio de la carrera (ms) */
  at: number;
  runId?: string;
}

export interface Source {
  key: SourceKey;
  timeS: number;
  at: number;
  ageDays: number;
  /** ventana en la que se encontró (91, 182 o 365 días) */
  window: number;
  runId?: string;
}

export interface Prediction {
  key: TargetKey;
  label: string;
  timeS: number;
  lowS: number;
  highS: number;
  confidence: Confidence;
  sources: (Source & { estimateS: number; weight: number })[];
}

export const riegel = (t: number, d: number, D: number, k: number) => t * (D / d) ** k;

/** Mejor esfuerzo por distancia, en la ventana más reciente que lo tenga. */
export function pickSources(efforts: readonly EffortIn[], now: number): Source[] {
  const out: Source[] = [];
  for (const key of Object.keys(SOURCE_M) as SourceKey[]) {
    const mine = efforts.filter((e) => e.key === key && e.at <= now && e.timeS > 0);
    for (const w of WINDOWS) {
      const inW = mine.filter((e) => now - e.at <= w * DAY);
      if (!inW.length) continue;
      const best = inW.reduce((b, e) => (e.timeS < b.timeS ? e : b));
      out.push({ key, timeS: best.timeS, at: best.at, ageDays: Math.floor((now - best.at) / DAY), window: w, runId: best.runId });
      break;
    }
  }
  return out;
}

export function predictTarget(target: (typeof TARGETS)[number], sources: readonly Source[], longestRecentM: number): Prediction | null {
  if (target.key === "marathon" && longestRecentM < MARATHON_MIN_RUN_M) return null;
  const D = target.m;
  const usable = sources
    .map((s) => ({ ...s, d: SOURCE_M[s.key] }))
    .filter((s) => Math.max(D / s.d, s.d / D) <= MAX_RATIO + 1e-9);
  if (!usable.length) return null;
  const rows = usable.map((s) => {
    const weight = AGE_WEIGHT[s.window as (typeof WINDOWS)[number]] / (1 + 1.5 * Math.abs(Math.log(D / s.d)));
    return { ...s, weight, estimateS: riegel(s.timeS, s.d, D, K_CENTRAL), lo: Math.min(...K_RANGE.map((k) => riegel(s.timeS, s.d, D, k))), hi: Math.max(...K_RANGE.map((k) => riegel(s.timeS, s.d, D, k))) };
  });
  const wsum = rows.reduce((a, r) => a + r.weight, 0);
  const timeS = rows.reduce((a, r) => a + r.estimateS * r.weight, 0) / wsum;
  const close = (r: (typeof rows)[number]) => Math.max(D / r.d, r.d / D) <= CLOSE_RATIO;
  const recent = rows.filter((r) => r.window === 91);
  const confidence: Confidence =
    recent.length >= 2 && recent.some((r) => Math.max(D / r.d, r.d / D) <= SAME_RATIO) ? "alta" : rows.some((r) => r.window <= 182 && close(r)) ? "media" : "baja";
  return {
    key: target.key,
    label: target.label,
    timeS,
    lowS: Math.min(timeS, ...rows.map((r) => r.lo)),
    highS: Math.max(timeS, ...rows.map((r) => r.hi)),
    confidence,
    sources: rows
      .sort((a, b) => b.weight - a.weight)
      .map(({ key, timeS: t, at, ageDays, window, runId, estimateS, weight }) => ({ key, timeS: t, at, ageDays, window, runId, estimateS, weight })),
  };
}

/** Predicciones en un momento dado, solo con los datos que había entonces. */
export function predictAt(efforts: readonly EffortIn[], runs: readonly { at: number; distanceM: number | null }[], now: number): Prediction[] {
  const sources = pickSources(efforts, now);
  const longest = runs.filter((r) => r.at <= now && now - r.at <= 365 * DAY).reduce((m, r) => Math.max(m, r.distanceM ?? 0), 0);
  return TARGETS.map((t) => predictTarget(t, sources, longest)).filter((p): p is Prediction => p !== null);
}

export interface PredictionPoint {
  /** AAAA-MM (fin de ese mes, o hoy en el mes actual) */
  month: string;
  timeS: number;
  lowS: number;
  highS: number;
  confidence: Confidence;
}

/** Evolución por meses: cada mes, la predicción con los datos que había a final de mes. */
export function predictionHistory(
  efforts: readonly EffortIn[],
  runs: readonly { at: number; distanceM: number | null }[],
  now: number,
  months = 24,
): Record<TargetKey, PredictionPoint[]> {
  const out: Record<TargetKey, PredictionPoint[]> = { "5k": [], "10k": [], half: [], marathon: [] };
  const d = new Date(now);
  for (let i = months - 1; i >= 0; i--) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() - i;
    const end = i === 0 ? now : Date.UTC(y, m + 1, 1) - 1;
    const month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    for (const p of predictAt(efforts, runs, end)) out[p.key].push({ month, timeS: p.timeS, lowS: p.lowS, highS: p.highS, confidence: p.confidence });
  }
  return out;
}

/** h:mm:ss o m:ss */
export function fmtRaceTime(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
