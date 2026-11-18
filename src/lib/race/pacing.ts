/**
 * Estrategia de ritmos por km para una carrera objetivo. Lógica pura, con pruebas.
 * - Uniforme; negativa 2 % o 5 % (la segunda mitad, ese tanto más rápida que la primera);
 *   positiva 2 % (al revés). Rampa lineal del ritmo a lo largo de la carrera.
 * - Con perfil (GPX): cada km se multiplica por el coste de su pendiente (Minetti, el mismo del
 *   ritmo ajustado por pendiente): mismo esfuerzo → más lento subiendo, algo más rápido bajando.
 * - Los parciales suman EXACTAMENTE el tiempo objetivo (se redondea el acumulado, no cada km).
 */
import { gradeAlong, minettiCost } from "@/lib/analysis/run-stream";
import type { RaceProfile } from "./race";

export type Strategy = "even" | "neg2" | "neg5" | "pos2";
export const STRATEGIES: { key: Strategy; label: string; hint: string; split: number }[] = [
  { key: "even", label: "Uniforme", hint: "El mismo ritmo de principio a fin.", split: 0 },
  { key: "neg2", label: "Negativa 2 %", hint: "Segunda mitad un 2 % más rápida que la primera.", split: -0.02 },
  { key: "neg5", label: "Negativa 5 %", hint: "Segunda mitad un 5 % más rápida que la primera.", split: -0.05 },
  { key: "pos2", label: "Positiva 2 %", hint: "Segunda mitad un 2 % más lenta que la primera.", split: 0.02 },
];
export const isStrategy = (x: unknown): x is Strategy => STRATEGIES.some((s) => s.key === x);

export interface PaceRow {
  km: number;
  /** longitud del tramo (m): 1000 salvo el último */
  lengthM: number;
  paceS: number;
  splitS: number;
  cumS: number;
  /** HH:MM:SS del paso por el final del tramo (si hay hora de salida) */
  clock: string | null;
  /** pendiente media del tramo (tanto por uno) si hay perfil */
  grade: number | null;
}

/** Pendiente media de [a, b] metros según el perfil. */
function gradeIn(profile: RaceProfile, grades: (number | null)[], a: number, b: number): number | null {
  const g: number[] = [];
  for (let i = 0; i < profile.d.length; i++) if (profile.d[i] >= a && profile.d[i] <= b && grades[i] !== null) g.push(grades[i]!);
  return g.length ? g.reduce((x, y) => x + y, 0) / g.length : null;
}

export function pacePlan(o: { distanceM: number; targetS: number; strategy: Strategy; profile?: RaceProfile | null; startTime?: string | null }): PaceRow[] {
  const D = o.distanceM;
  const segs: { a: number; b: number }[] = [];
  for (let a = 0; a < D - 0.5; a += 1000) segs.push({ a, b: Math.min(D, a + 1000) });
  // Rampa: multiplicador 1+δ al principio y 1−δ al final; las mitades difieren en `split`.
  const split = STRATEGIES.find((s) => s.key === o.strategy)!.split;
  const delta = split === 0 ? 0 : (-2 * split) / (2 + split); // (1+δ/2)/(1−δ/2) = 1 − split
  const grades = o.profile ? gradeAlong(o.profile.d, o.profile.e) : null;
  const weights = segs.map(({ a, b }) => {
    const mid = (a + b) / 2 / D;
    const ramp = 1 + delta * (1 - 2 * mid);
    const g = o.profile && grades ? gradeIn(o.profile, grades, a, b) : null;
    const cost = g === null ? 1 : minettiCost(g) / minettiCost(0);
    return { w: ramp * cost * (b - a), g };
  });
  const total = weights.reduce((x, y) => x + y.w, 0);
  const T = Math.round(o.targetS);
  let acc = 0;
  let prevCum = 0;
  const start = o.startTime ? Number(o.startTime.slice(0, 2)) * 3600 + Number(o.startTime.slice(3, 5)) * 60 : null;
  return segs.map((s, i) => {
    acc += weights[i].w;
    const cum = i === segs.length - 1 ? T : Math.round((T * acc) / total);
    const split = cum - prevCum;
    prevCum = cum;
    const len = s.b - s.a;
    return {
      km: i + 1,
      lengthM: Math.round(len),
      paceS: (split / len) * 1000,
      splitS: split,
      cumS: cum,
      clock: start === null ? null : clockOf(start + cum),
      grade: weights[i].g,
    };
  });
}

export function clockOf(s: number): string {
  const t = Math.round(s) % 86_400;
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((x) => String(x).padStart(2, "0")).join(":");
}

/** Tiempo de la primera y la segunda mitad (por distancia) de un plan. */
export function halves(rows: readonly PaceRow[], distanceM: number): [number, number] {
  let first = 0;
  let pos = 0;
  for (const r of rows) {
    const end = pos + r.lengthM;
    const inFirst = Math.max(0, Math.min(end, distanceM / 2) - pos);
    first += (r.splitS * inFirst) / r.lengthM;
    pos = end;
  }
  const total = rows.at(-1)?.cumS ?? 0;
  return [first, total - first];
}
