/**
 * Mejores esfuerzos dentro de una carrera.
 *
 * - Línea de tiempo: distancia acumulada del reloj frente al tiempo transcurrido.
 * - Las pausas parten la carrera: un hueco de más de PAUSE_GAP_S sin distancia separa
 *   tramos continuos, y un esfuerzo tiene que caber entero en un tramo (correr de verdad,
 *   sin paradas; ni se descuenta la pausa ni se suma). Como de cada muestra solo se guarda
 *   el final de su intervalo, un hueco largo es pausa solo si la muestra que lo cierra
 *   cubre muy poca distancia para ese tiempo (< 1 m/s): tras una pausa, el reloj solo
 *   registra sus pocos segundos; una muestra larga y continua cubre distancia de carrera.
 * - Ventana deslizante con interpolación lineal: el inicio o el final pueden caer entre
 *   dos muestras.
 * - Red de seguridad: se descarta cualquier esfuerzo más rápido de 2:30 /km.
 */

export const PAUSE_GAP_S = 15;
/** Por debajo de esta velocidad media en el hueco, la muestra no lo cubre: es una pausa. */
const PAUSE_SPEED_MPS = 1;
/**
 * Muestra inválida. De cada muestra solo se guarda el final de su intervalo. El reloj registra
 * muestras completas de ~300 s y, entre medias, muestras finas de 2–3 s que se solapan con ellas:
 * una muestra larga que llega detrás de muestras finas tiene un hueco (desde la anterior) más
 * corto que su intervalo real, así que su velocidad implícita sale inflada y fabrica récords
 * (4-jul-2026: 886 m en 105 s = 2:00 /km; 946 m en 141 s; 929 m en 236 s = 3,94 m/s, que no
 * supera ningún umbral de velocidad razonable pero tiene un intervalo real de ~305 s).
 *
 * Una muestra se descarta (y parte el tramo antes y después) cuando:
 * - hueco ≥ MIN_GAP_CHECK_S (10 s) y velocidad > MAX_SPEED_MPS (7 m/s ≈ 2:23 /km), sea cual sea; o
 * - es «larga con hueco corto»: ≥ MIN_LONG_SAMPLE_M (300 m) con un hueco de 10 s a
 *   FULL_SAMPLE_GAP_S (270 s) y detrás de una muestra que tampoco era completa (hueco < 270 s).
 *   Una muestra final más corta detrás de una completa es legítima y no se toca.
 * Con huecos < 10 s no se juzga: las muestras de 2–3 s con 14–17 m son redondeo de segundos.
 * En los datos reales son 38 muestras en 26 carreras, todas con distancia de ~800–1300 m.
 */
export const MAX_SPEED_MPS = 7;
export const MIN_GAP_CHECK_S = 10;
export const FULL_SAMPLE_GAP_S = 270;
export const MIN_LONG_SAMPLE_M = 300;

/** ¿La muestra (v metros tras un hueco de `gap` s; `prevGap` = hueco de la muestra anterior) es inválida? */
export function isImplausibleSample(v: number, gap: number, prevGap: number = Infinity): boolean {
  if (gap < MIN_GAP_CHECK_S) return false;
  if (v / gap > MAX_SPEED_MPS) return true;
  return v >= MIN_LONG_SAMPLE_M && gap < FULL_SAMPLE_GAP_S && prevGap < FULL_SAMPLE_GAP_S;
}
export const MIN_PACE_S_PER_KM = 150; // 2:30 /km

export const EFFORT_DISTANCES = [
  { key: "1k", label: "1 km", m: 1000 },
  { key: "1mi", label: "1 milla", m: 1609.344 },
  { key: "5k", label: "5 km", m: 5000 },
  { key: "10k", label: "10 km", m: 10000 },
  { key: "half", label: "Media maratón", m: 21097.5 },
  { key: "marathon", label: "Maratón", m: 42195 },
] as const;
export type EffortKey = (typeof EFFORT_DISTANCES)[number]["key"];

export interface Effort {
  key: EffortKey;
  distanceM: number;
  timeS: number;
  /** Segundos desde el inicio de la carrera en que empieza el esfuerzo. */
  startS: number;
  /** mayor hueco entre muestras dentro del tramo del esfuerzo (s) */
  maxGapS: number;
}

/** Por encima de este hueco entre muestras dentro del tramo, el esfuerzo se marca «≈». */
export const COARSE_GAP_S = 60;
export const isCoarse = (maxGapS: number | null | undefined) => maxGapS != null && maxGapS > COARSE_GAP_S;

/** Mayor hueco entre muestras consecutivas que se solapan con el tramo (startS, startS + timeS). */
export function maxGapIn(t: readonly number[], startS: number, timeS: number): number {
  let gap = 0;
  for (let i = 1; i < t.length; i++) if (t[i] > startS && t[i - 1] < startS + timeS) gap = Math.max(gap, t[i] - t[i - 1]);
  return gap;
}

/**
 * Tramos continuos a partir de muestras por intervalo (t = fin del intervalo en s desde el
 * inicio, v = metros del intervalo). Devuelve, por tramo, tiempos y distancia acumulada.
 */
export function continuousSegments(t: readonly number[], v: readonly number[]): { t: number[]; d: number[] }[] {
  const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const segs: { t: number[]; d: number[] }[] = [];
  let cur: { t: number[]; d: number[] } | null = null;
  let prevT = 0;
  let first = true;
  let afterInvalid = false;
  let prevGap = Infinity;
  for (const i of order) {
    const gap = t[i] - prevT;
    const lastGap = prevGap;
    prevGap = gap;
    const isPause = gap > PAUSE_GAP_S && v[i] / gap < PAUSE_SPEED_MPS;
    // Muestra inválida: se descarta y el tramo se parte antes y después (ningún esfuerzo la cruza).
    if (isImplausibleSample(v[i], gap, lastGap)) {
      cur = null;
      prevT = t[i];
      first = false;
      afterInvalid = true;
      continue;
    }
    if (!cur || isPause) {
      // Nuevo tramo: empieza en la muestra anterior (si la hay) con distancia 0 para que el
      // primer intervalo tenga duración; tras una pausa se toma el hueco típico (3 s) como inicio.
      // Tras una muestra inválida, el tramo empieza donde ella termina (el hueco entero es de esta muestra).
      const startT: number = first ? 0 : afterInvalid ? prevT : Math.max(prevT, t[i] - Math.min(gap, 3));
      cur = { t: [startT], d: [0] };
      segs.push(cur);
    }
    cur.t.push(t[i]);
    cur.d.push(cur.d[cur.d.length - 1] + v[i]);
    prevT = t[i];
    first = false;
    afterInvalid = false;
  }
  return segs;
}

/** Tiempo mínimo para cubrir `target` metros dentro de un tramo (interpolando). */
export function bestInSegment(seg: { t: number[]; d: number[] }, target: number): { timeS: number; startS: number } | null {
  const { t, d } = seg;
  const n = t.length;
  if (n < 2 || d[n - 1] < target) return null;
  // Tiempo en el que se alcanza la distancia x (interpolación lineal), avanzando con un puntero.
  const at = (x: number, from: number): [number, number] => {
    let k = Math.max(1, from);
    while (k < n - 1 && d[k] < x) k++;
    const d0 = d[k - 1],
      d1 = d[k];
    const f = d1 > d0 ? Math.min(1, Math.max(0, (x - d0) / (d1 - d0))) : 1;
    return [t[k - 1] + f * (t[k] - t[k - 1]), k];
  };
  let best: { timeS: number; startS: number } | null = null;
  // a) Empezando en cada muestra.
  let kEnd = 1;
  for (let i = 0; i < n && d[i] + target <= d[n - 1]; i++) {
    const [tEnd, k] = at(d[i] + target, kEnd);
    kEnd = k;
    const time = tEnd - t[i];
    if (!best || time < best.timeS) best = { timeS: time, startS: t[i] };
  }
  // b) Terminando en cada muestra (el inicio cae entre muestras).
  let kStart = 1;
  for (let j = 0; j < n; j++) {
    if (d[j] < target) continue;
    const [tStart, k] = at(d[j] - target, kStart);
    kStart = k;
    const time = t[j] - tStart;
    if (!best || time < best.timeS) best = { timeS: time, startS: tStart };
  }
  return best;
}

/** Mejores esfuerzos de una carrera para todas las distancias que quepan en algún tramo. */
export function bestEfforts(t: readonly number[], v: readonly number[]): Effort[] {
  const segs = continuousSegments(t, v);
  const out: Effort[] = [];
  for (const dist of EFFORT_DISTANCES) {
    let best: { timeS: number; startS: number } | null = null;
    for (const s of segs) {
      const b = bestInSegment(s, dist.m);
      // Red de seguridad: un tramo con esfuerzo más rápido de 2:30 /km está mal; se ignora ese tramo.
      if (!b || b.timeS / (dist.m / 1000) < MIN_PACE_S_PER_KM) continue;
      if (!best || b.timeS < best.timeS) best = b;
    }
    if (best) out.push({ key: dist.key, distanceM: dist.m, timeS: best.timeS, startS: best.startS, maxGapS: maxGapIn(t, best.startS, best.timeS) });
  }
  return out;
}

// ─── Récords y su evolución ──────────────────────────────────────────────────

export interface RunEffort {
  runId: string;
  startAt: Date;
  key: EffortKey;
  timeS: number;
}

export interface RecordPoint extends RunEffort {
  /** true si en su fecha batió el récord vigente. */
  isRecord: boolean;
}

/** Esfuerzos de una distancia en orden de fecha, marcando los que fueron récord. */
export function recordProgression(efforts: RunEffort[]): RecordPoint[] {
  let best = Infinity;
  return [...efforts]
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((e) => {
      const isRecord = e.timeS < best;
      if (isRecord) best = e.timeS;
      return { ...e, isRecord };
    });
}

/** Mejora en % del primer récord al actual (positivo = más rápido). */
export function improvementPct(points: RecordPoint[]): number | null {
  const recs = points.filter((p) => p.isRecord);
  if (recs.length < 2) return null;
  return ((recs[0].timeS - recs[recs.length - 1].timeS) / recs[0].timeS) * 100;
}

/**
 * Récord de una distancia y, si viene de muestras gruesas («≈»), el mejor con muestras finas (si
 * lo hay). Los récords con «≈» siguen siendo récords: solo llevan la marca.
 */
export function recordWithFine<T extends { timeS: number; maxGapS: number | null }>(efforts: readonly T[]): { best: (T & { coarse: boolean }) | null; bestFine: T | null } {
  const best = efforts.reduce<T | null>((b, e) => (!b || e.timeS < b.timeS ? e : b), null);
  if (!best) return { best: null, bestFine: null };
  const coarse = isCoarse(best.maxGapS);
  const bestFine = coarse ? efforts.filter((e) => !isCoarse(e.maxGapS)).reduce<T | null>((b, e) => (!b || e.timeS < b.timeS ? e : b), null) : null;
  return { best: { ...best, coarse }, bestFine };
}
