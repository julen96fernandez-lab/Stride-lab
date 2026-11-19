/**
 * «Sesiones parecidas» del detalle: la carrera frente a las 5 últimas del mismo tipo y distancia
 * ±20 % de los 12 meses anteriores (ver pickSimilar). Lógica pura, con pruebas.
 * - Con menos de 3 parecidas no se compara.
 * - Cada métrica (ritmo, pulso medio, carga) solo si esta carrera la tiene y al menos 3 parecidas
 *   también; el pulso, solo si es fiable (muestras ≥ 80 % de la carrera).
 * - Posición: en el ritmo, de más rápida a más lenta; en pulso y carga, de más bajo a más alto
 *   (sin juzgar: más carga no es mejor ni peor).
 */
import { SUMMARY_RULES } from "./summary";

export type SimilarMetric = "pace" | "hr" | "load";

export interface SimilarPoint {
  id: string;
  startAt: Date;
  paceS: number | null;
  /** pulso medio, ya filtrado: null si no es fiable */
  avgHr: number | null;
  load: number | null;
  current: boolean;
}

export interface MetricCompare {
  key: SimilarMetric;
  /** de la más antigua a la actual */
  bars: { id: string; startAt: Date; value: number; current: boolean }[];
  /** media de las parecidas (sin la actual) */
  mean: number;
  /** posición de la actual (1 = la más rápida / la más baja) */
  rank: number;
  of: number;
  /** frase corta: «La 2.ª más rápida de 6» */
  position: string;
}

const LABEL: Record<SimilarMetric, (o: { rank: number; of: number }) => string> = {
  pace: ({ rank, of }) => (rank === 1 ? `La más rápida de ${of}` : rank === of ? `La más lenta de ${of}` : `La ${rank}.ª más rápida de ${of}`),
  hr: ({ rank, of }) => (rank === 1 ? `El pulso medio más bajo de ${of}` : rank === of ? `El pulso medio más alto de ${of}` : `El ${rank}.º pulso medio más bajo de ${of}`),
  load: ({ rank, of }) => (rank === 1 ? `La carga más baja de ${of}` : rank === of ? `La carga más alta de ${of}` : `La ${rank}.ª carga más baja de ${of}`),
};

const value = (p: SimilarPoint, k: SimilarMetric) => (k === "pace" ? p.paceS : k === "hr" ? p.avgHr : p.load);

export function compareSimilar(current: SimilarPoint, similar: readonly SimilarPoint[]): MetricCompare[] | null {
  const min = SUMMARY_RULES.similar.min;
  if (similar.length < min) return null;
  const out: MetricCompare[] = [];
  for (const key of ["pace", "hr", "load"] as const) {
    const cur = value(current, key);
    const others = similar.filter((p) => value(p, key) !== null);
    if (cur === null || others.length < min) continue;
    const bars = [...others, current]
      .map((p) => ({ id: p.id, startAt: p.startAt, value: value(p, key)!, current: p.current }))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    // Empates: la actual va delante (no se penaliza un empate).
    const rank = 1 + others.filter((p) => value(p, key)! < cur).length;
    const of = bars.length;
    out.push({ key, bars, mean: others.reduce((a, p) => a + value(p, key)!, 0) / others.length, rank, of, position: LABEL[key]({ rank, of }) });
  }
  return out.length ? out : null;
}
