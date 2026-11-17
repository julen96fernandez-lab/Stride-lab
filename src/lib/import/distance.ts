/**
 * Distancia de un entrenamiento sin duplicar lo que Apple repite.
 *
 * En sesiones con bloques (calentamiento, series…) el Apple Watch escribe una
 * estadística DistanceWalkingRunning por cada <WorkoutActivity> y, a veces, otra a
 * nivel de <Workout> con el total. Orden de elección:
 *   1. Estadística a nivel de entrenamiento que cubre la sesión (≥ 95 % del tiempo) → esa sola.
 *   2. Si no, suma de las de los bloques, solo si no se solapan y cubren ≥ 90 % → la suma.
 *   3. Si no, queda pendiente: se usará la suma de las muestras de distancia del reloj
 *      (se resuelve al final de la importación). Mientras, se guarda la mejor provisional.
 * Nunca se suman a la vez la del entrenamiento y las de los bloques.
 */
import { attr, parseHealthDate } from "./xml";
import { toMeters } from "./units";

export interface DistanceStat {
  level: "workout" | "activity";
  startMs: number;
  endMs: number;
  meters: number;
}

export type DistanceSource = "workout" | "activities" | "samples_pending" | "totalDistance";

const WORKOUT_COVER = 0.95;
const ACTIVITY_COVER = 0.9;
const OVERLAP_TOLERANCE_MS = 2000;

/** Todas las estadísticas DistanceWalkingRunning del <Workout>, con su nivel. */
export function allDistanceStats(xml: string): DistanceStat[] {
  const blocks: [number, number][] = [];
  let i = xml.indexOf("<WorkoutActivity");
  while (i !== -1) {
    const tagEnd = xml.indexOf(">", i);
    const selfClosing = xml[tagEnd - 1] === "/";
    const end = selfClosing ? tagEnd : xml.indexOf("</WorkoutActivity>", tagEnd);
    blocks.push([i, end === -1 ? xml.length : end]);
    i = xml.indexOf("<WorkoutActivity", end === -1 ? xml.length : end);
  }
  const out: DistanceStat[] = [];
  const re = /<WorkoutStatistics [^>]*type="HKQuantityTypeIdentifierDistanceWalkingRunning"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const meters = toMeters(attr(tag, "sum"), attr(tag, "unit"));
    const s = parseHealthDate(attr(tag, "startDate"));
    const e = parseHealthDate(attr(tag, "endDate"));
    if (meters === null || !s || !e) continue;
    const inBlock = blocks.some(([a, b]) => m!.index > a && m!.index < b);
    out.push({ level: inBlock ? "activity" : "workout", startMs: s.getTime(), endMs: e.getTime(), meters });
  }
  return out;
}

export function chooseDistance(
  stats: DistanceStat[],
  startMs: number,
  endMs: number,
): { meters: number | null; source: DistanceSource | null } {
  const span = Math.max(1, endMs - startMs);
  const cover = (s: { startMs: number; endMs: number }) => (Math.min(s.endMs, endMs) - Math.max(s.startMs, startMs)) / span;

  const wk = stats.filter((s) => s.level === "workout").sort((a, b) => cover(b) - cover(a))[0];
  if (wk && cover(wk) >= WORKOUT_COVER) return { meters: wk.meters, source: "workout" };

  const acts = stats.filter((s) => s.level === "activity").sort((a, b) => a.startMs - b.startMs);
  if (acts.length) {
    const overlaps = acts.some((s, k) => k > 0 && s.startMs < acts[k - 1].endMs - OVERLAP_TOLERANCE_MS);
    const covered = acts.reduce((a, s) => a + Math.max(0, Math.min(s.endMs, endMs) - Math.max(s.startMs, startMs)), 0) / span;
    if (!overlaps && covered >= ACTIVITY_COVER) return { meters: acts.reduce((a, s) => a + s.meters, 0), source: "activities" };
  }

  // Ninguna cubre la sesión: provisional (la que más cubre) hasta tener las muestras del reloj.
  const best = [...stats].sort((a, b) => cover(b) - cover(a))[0];
  return best ? { meters: best.meters, source: "samples_pending" } : { meters: null, source: null };
}
