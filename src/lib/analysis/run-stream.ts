/**
 * Línea de tiempo común de una carrera para los gráficos sincronizados del detalle.
 *
 * Todo se remuestrea a una rejilla de tiempo (s desde el inicio). En cada instante:
 * distancia acumulada, ritmo suavizado (~30 s), ritmo ajustado por pendiente (GAP), pulso,
 * altitud, potencia, zona y posición en el mapa. Nada se inventa: donde una serie no tiene
 * datos cerca, el valor es null y el gráfico deja un hueco.
 *
 * El ritmo usa las mismas reglas de validez que los récords (`continuousSegments`): las pausas
 * y las muestras de distancia imposibles parten la carrera, y una ventana de suavizado nunca
 * cruza un corte (ahí no hay ritmo).
 */
import { continuousSegments } from "./best-efforts";
import { zoneOf, type HrZones } from "./hr-zones";

export interface Series {
  t: readonly number[];
  v: readonly number[];
}

export interface Track {
  /** s desde el inicio de la carrera */
  t: number[];
  lat: number[];
  lon: number[];
  /** altitud en m, o null si el GPX no la trae */
  ele: (number | null)[];
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Índice del valor de `xs` (ordenado ascendente) más cercano a `x`. -1 si `xs` está vacío. */
export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  if (x <= xs[0]) return 0;
  if (x >= xs[n - 1]) return n - 1;
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return x - xs[lo] <= xs[hi] - x ? lo : hi;
}

/** Primer índice con xs[i] >= x (búsqueda binaria). */
function lowerBound(xs: ArrayLike<number>, x: number): number {
  let lo = 0,
    hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Mediana de los intervalos entre muestras (s). */
export function medianStep(t: readonly number[]): number {
  if (t.length < 2) return Infinity;
  const d = t
    .slice(1)
    .map((x, i) => x - t[i])
    .sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/**
 * Valor de una serie en el instante `x`, interpolando entre las dos muestras que lo rodean,
 * o null si el hueco entre ellas supera `maxGap` (no se inventa nada en los huecos).
 */
export function sampleAt(s: Series, x: number, maxGap: number): number | null {
  const n = s.t.length;
  if (n === 0) return null;
  const j = lowerBound(s.t, x);
  if (j < n && s.t[j] === x) return s.v[j];
  if (j === 0) return s.t[0] - x <= maxGap / 2 ? s.v[0] : null;
  if (j === n) return x - s.t[n - 1] <= maxGap / 2 ? s.v[n - 1] : null;
  const t0 = s.t[j - 1],
    t1 = s.t[j];
  if (t1 - t0 > maxGap) {
    // Hueco grande: solo vale si x está muy cerca de una de las dos muestras.
    if (x - t0 <= maxGap / 2) return s.v[j - 1];
    if (t1 - x <= maxGap / 2) return s.v[j];
    return null;
  }
  const f = (x - t0) / (t1 - t0);
  return s.v[j - 1] + f * (s.v[j] - s.v[j - 1]);
}

// ─── Ritmo ───────────────────────────────────────────────────────────────────

/** Por debajo de esta velocidad (≈ 25:00 /km) se considera parado: no hay ritmo. */
export const MIN_MOVING_MPS = 0.66;
/** Muestras de distancia más espaciadas que esto = carrera antigua (cada ~5 min): ritmo por parciales. */
export const COARSE_STEP_S = 60;

/** ¿Las muestras de distancia son demasiado espaciadas para una curva de ritmo? */
export function isCoarse(distance: Series | null | undefined): boolean {
  return !distance || distance.t.length < 3 || medianStep(distance.t) > COARSE_STEP_S;
}

/**
 * Velocidad (m/s) suavizada en cada instante de `grid`: distancia recorrida en la ventana
 * [x − w/2, x + w/2] dividida por su duración, dentro de un único tramo continuo. Si la ventana
 * no cabe entera en un tramo, se recorta a él (con al menos la mitad de la ventana); si no, null.
 */
export function smoothSpeed(distance: Series, grid: readonly number[], windowS = 30): (number | null)[] {
  const segs = continuousSegments(distance.t, distance.v);
  const half = windowS / 2;
  return grid.map((x) => {
    const seg = segs.find((s) => x >= s.t[0] && x <= s.t[s.t.length - 1]);
    if (!seg) return null;
    const a = Math.max(seg.t[0], x - half);
    const b = Math.min(seg.t[seg.t.length - 1], x + half);
    if (b - a < half) return null;
    const da = interp(seg.t, seg.d, a);
    const db = interp(seg.t, seg.d, b);
    const v = (db - da) / (b - a);
    return v >= MIN_MOVING_MPS ? v : null;
  });
}

function interp(t: readonly number[], d: readonly number[], x: number): number {
  const j = lowerBound(t, x);
  if (j <= 0) return d[0];
  if (j >= t.length) return d[d.length - 1];
  const f = (x - t[j - 1]) / (t[j] - t[j - 1] || 1);
  return d[j - 1] + f * (d[j] - d[j - 1]);
}

/** s/km a partir de m/s (null si no hay velocidad). */
export const paceFromSpeed = (v: number | null): number | null => (v && v > 0 ? 1000 / v : null);

// ─── Ritmo ajustado por pendiente (GAP) ─────────────────────────────────────

/**
 * Coste energético de correr (J/kg/m) según la pendiente (Minetti et al., 2002), válido entre
 * −45 % y +45 %. En llano vale 3,6.
 */
export function minettiCost(grade: number): number {
  const i = Math.max(-0.45, Math.min(0.45, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/**
 * Ritmo ajustado por pendiente: el ritmo en llano que costaría lo mismo. Subiendo sale más
 * rápido que el real; bajando suave, más lento (bajar cuesta menos), y en bajadas muy fuertes
 * vuelve a costar más.
 */
export function gradeAdjustedPace(pace: number, grade: number): number {
  return (pace * 3.6) / minettiCost(grade);
}

/**
 * Pendiente (tanto por uno) en cada punto: desnivel entre los puntos a ±`halfM` metros de
 * distancia, dividido por la distancia entre ellos. null si falta altitud o hay < 20 m.
 */
export function gradeAlong(dist: readonly (number | null)[], ele: readonly (number | null)[], halfM = 50): (number | null)[] {
  const idx: number[] = [];
  for (let i = 0; i < dist.length; i++) if (dist[i] !== null && ele[i] !== null) idx.push(i);
  const ds = idx.map((i) => dist[i]!);
  return dist.map((d, i) => {
    if (d === null || ele[i] === null || !idx.length) return null;
    const a = idx[Math.max(0, lowerBound(ds, d - halfM))];
    const b = idx[Math.min(idx.length - 1, lowerBound(ds, d + halfM))];
    const run = dist[b]! - dist[a]!;
    if (run < 20) return null;
    return (ele[b]! - ele[a]!) / run;
  });
}

// ─── Parciales ───────────────────────────────────────────────────────────────

export interface SplitRow {
  idx: number;
  distanceM: number;
  durationS: number;
  paceSPerKm: number | null;
  avgHr: number | null;
  elevationGainM: number | null;
  elevationLossM?: number | null;
}

export interface SplitView extends SplitRow {
  /** Inicio y fin del parcial (s desde el inicio de la carrera). */
  t0: number;
  t1: number;
  /** 0…1: longitud de la barra (1 = el más rápido). */
  bar: number;
  fastest: boolean;
  slowest: boolean;
  /** Último parcial incompleto (< 990 m). */
  partial: boolean;
}

/**
 * Parciales listos para la tabla: tramo de tiempo de cada uno (los parciales se calculan
 * seguidos desde la primera muestra, así que el inicio de cada uno es la suma de los
 * anteriores), barra de ritmo relativo y marcas del más rápido y el más lento. El último
 * parcial incompleto no compite por más rápido ni más lento.
 */
export function splitViews(splits: readonly SplitRow[], startS = 0): SplitView[] {
  let t = startS;
  const full = splits.filter((s) => s.distanceM >= 990 && s.paceSPerKm !== null).map((s) => s.paceSPerKm!);
  const fast = full.length ? Math.min(...full) : null;
  const slow = full.length ? Math.max(...full) : null;
  // Si todos van al mismo ritmo (al segundo), no hay más rápido ni más lento.
  const tie = fast === null || slow === null || Math.round(fast) === Math.round(slow);
  let fastDone = false,
    slowDone = false;
  return splits.map((s) => {
    const t0 = t;
    t += s.durationS;
    const partial = s.distanceM < 990;
    const p = s.paceSPerKm;
    const isFast = !tie && !partial && p !== null && p === fast && !fastDone && full.length > 1;
    const isSlow = !tie && !partial && p !== null && p === slow && !slowDone && full.length > 1;
    if (isFast) fastDone = true;
    if (isSlow) slowDone = true;
    const bar = p === null || fast === null || slow === null ? 0 : tie ? 1 : 0.35 + (0.65 * (slow - Math.min(Math.max(p, fast), slow))) / (slow - fast);
    return { ...s, t0, t1: t, bar, fastest: isFast, slowest: isSlow, partial };
  });
}

// ─── Línea de tiempo común ──────────────────────────────────────────────────

export interface RunStream {
  /** s desde el inicio */
  t: number[];
  /** km acumulados (null antes de la primera muestra de distancia) */
  km: (number | null)[];
  /** s/km suavizado; null = parado, pausa o muestra inválida */
  pace: (number | null)[];
  /** s/km ajustado por pendiente (solo si hay altitud) */
  gap: (number | null)[] | null;
  hr: (number | null)[] | null;
  ele: (number | null)[] | null;
  power: (number | null)[] | null;
  zone: (number | null)[] | null;
  /** índice del punto de la pista más cercano (para el mapa), o null sin pista */
  trackIdx: number[] | null;
  /** el ritmo no se puede dibujar como curva (muestras cada ~5 min): usar parciales */
  coarsePace: boolean;
  /** ritmo medio de referencia (s/km) */
  avgPace: number | null;
}

/** Paso de la rejilla: ~1 punto cada 3 s, como mucho ~1500 puntos (fluido en el iPhone). */
export function gridStep(durationS: number, maxPoints = 1500): number {
  return Math.max(3, Math.ceil(durationS / maxPoints));
}

export function buildStream(input: {
  durationS: number;
  distance?: Series | null;
  hr?: Series | null;
  power?: Series | null;
  track?: Track | null;
  zones?: HrZones | null;
  avgPace?: number | null;
}): RunStream {
  const { distance, hr, power, track, zones } = input;
  const end = Math.max(
    input.durationS,
    distance?.t.at(-1) ?? 0,
    hr?.t.at(-1) ?? 0,
    power?.t.at(-1) ?? 0,
    track?.t.at(-1) ?? 0,
  );
  const step = gridStep(end);
  const t: number[] = [];
  for (let x = 0; x <= end; x += step) t.push(x);
  if (t[t.length - 1] < end) t.push(end);

  // Distancia acumulada: todas las muestras (también la última km cuenta), interpolada.
  let km: (number | null)[] = t.map(() => null);
  if (distance && distance.t.length) {
    const order = distance.t.map((_, i) => i).sort((a, b) => distance.t[a] - distance.t[b]);
    const ct: number[] = [0];
    const cd: number[] = [0];
    let acc = 0;
    for (const i of order) {
      acc += distance.v[i];
      ct.push(distance.t[i]);
      cd.push(acc);
    }
    km = t.map((x) => interp(ct, cd, x) / 1000);
  } else if (track && track.t.length > 1) {
    // Sin muestras del reloj: distancia de la pista GPS.
    const cd = [0];
    for (let i = 1; i < track.t.length; i++) cd.push(cd[i - 1] + hav(track.lat[i - 1], track.lon[i - 1], track.lat[i], track.lon[i]));
    km = t.map((x) => interp(track.t, cd, x) / 1000);
  }

  const coarsePace = isCoarse(distance);
  const pace = !coarsePace && distance ? smoothSpeed(distance, t).map(paceFromSpeed) : t.map(() => null);

  const series = (s: Series | null | undefined) => {
    if (!s || s.t.length < 2) return null;
    const gap = Math.max(30, 4 * medianStep(s.t));
    const out = t.map((x) => sampleAt(s, x, gap));
    return out.some((v) => v !== null) ? out : null;
  };
  const hrOut = series(hr);
  const powerOut = series(power);

  let ele: (number | null)[] | null = null;
  let trackIdx: number[] | null = null;
  if (track && track.t.length > 1) {
    trackIdx = t.map((x) => nearestIndex(track.t, x));
    if (track.ele.some((e) => e !== null)) {
      const eleSeries: Series = {
        t: track.t.filter((_, i) => track.ele[i] !== null),
        v: track.ele.filter((e): e is number => e !== null),
      };
      ele = series(eleSeries);
    }
  }

  let gap: (number | null)[] | null = null;
  if (ele && !coarsePace) {
    const distM = km.map((k) => (k === null ? null : k * 1000));
    const grade = gradeAlong(distM, ele);
    gap = pace.map((p, i) => (p === null || grade[i] === null ? null : gradeAdjustedPace(p, grade[i]!)));
    if (!gap.some((v) => v !== null)) gap = null;
  }

  const zone = hrOut && zones ? hrOut.map((h) => (h === null ? null : zoneOf(h, zones.limits))) : null;

  return {
    t,
    km,
    pace,
    gap,
    hr: hrOut,
    ele,
    power: powerOut,
    zone,
    trackIdx,
    coarsePace,
    avgPace: input.avgPace ?? null,
  };
}

function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Pista reducida a partir de los puntos del GPX: como mucho un punto cada `minStepS` s. */
export function reduceTrack(
  pts: readonly { lat: number; lon: number; ele: number | null; time: number | null }[],
  startMs: number,
  minStepS = 2,
): Track | null {
  const timed = pts.filter((p) => p.time !== null);
  if (timed.length < 2) return null;
  const out: Track = { t: [], lat: [], lon: [], ele: [] };
  let last = -Infinity;
  for (let i = 0; i < timed.length; i++) {
    const p = timed[i];
    const s = (p.time! - startMs) / 1000;
    if (s - last < minStepS && i !== timed.length - 1) continue;
    out.t.push(Math.round(s * 10) / 10);
    out.lat.push(Math.round(p.lat * 1e6) / 1e6);
    out.lon.push(Math.round(p.lon * 1e6) / 1e6);
    out.ele.push(p.ele === null ? null : Math.round(p.ele * 10) / 10);
    last = s;
  }
  return out;
}

/** Paso «redondo» para el eje X: km (0,5/1/2/5/10) o tiempo (5/10/15/20/30/60 min), ≤ `max` marcas. */
export function niceXStep(span: number, kind: "dist" | "time", max = 5): number {
  const steps = kind === "dist" ? [0.5, 1, 2, 5, 10, 20] : [300, 600, 900, 1200, 1800, 3600, 7200];
  return steps.find((st) => span / st <= max) ?? steps[steps.length - 1];
}
