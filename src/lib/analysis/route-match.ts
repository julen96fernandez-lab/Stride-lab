/**
 * «Misma ruta»: ¿dos carreras recorren el mismo recorrido? Lógica pura, con pruebas.
 *
 * - Distancia dentro de un 5 %.
 * - Inicio con inicio y fin con fin a menos de 200 m (en el mismo sentido).
 * - Ambos trazados se reparten en 50 puntos a igual distancia recorrida y se comparan punto a
 *   punto: separación media ≤ 60 m y ningún punto a más de 250 m (tolerancia de GPS).
 * - La ruta invertida NO cuenta: un circuito al revés tiene el mismo inicio y fin, pero sus puntos
 *   intermedios no coinciden.
 * Las candidatas se filtran antes en la base de datos por recuadro y distancia (ROUTE_RULES.bboxDeg)
 * y solo se cargan sus trazados.
 */
export const ROUTE_RULES = {
  distPct: 0.05,
  endpointM: 200,
  samples: 50,
  meanM: 60,
  maxM: 250,
  /** prefiltro en la base de datos: cada lado del recuadro a menos de 0,003° (≈ 250–330 m) */
  bboxDeg: 0.003,
  /** coincidencias anteriores para mostrar la tarjeta */
  minMatches: 2,
} as const;

export type LatLon = readonly [number, number];

const R = 6_371_000;
/** Distancia en metros (equirectangular: sobra para tramos cortos). */
export function distM(a: LatLon, b: LatLon): number {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dx = (b[1] - a[1]) * (Math.PI / 180) * Math.cos(lat);
  const dy = (b[0] - a[0]) * (Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy) * R;
}

export function pathLength(pts: readonly LatLon[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distM(pts[i - 1], pts[i]);
  return s;
}

/** `n` puntos repartidos a igual distancia recorrida a lo largo del trazado. */
export function resample(pts: readonly LatLon[], n: number = ROUTE_RULES.samples): LatLon[] {
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distM(pts[i - 1], pts[i]));
  const total = cum.at(-1)!;
  if (total <= 0) return [];
  const out: LatLon[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const f = Math.min(1, Math.max(0, (target - cum[j - 1]) / seg));
    const a = pts[j - 1];
    const b = pts[j];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

export interface RouteShape {
  /** distancia oficial de la carrera (m) */
  distanceM: number | null;
  pts: readonly LatLon[];
}

/** ¿Misma ruta y en el mismo sentido? */
export function sameRoute(a: RouteShape, b: RouteShape): boolean {
  const RR = ROUTE_RULES;
  if (a.pts.length < 2 || b.pts.length < 2) return false;
  const da = a.distanceM ?? pathLength(a.pts);
  const db = b.distanceM ?? pathLength(b.pts);
  if (!(da > 0 && db > 0) || Math.abs(da / db - 1) > RR.distPct) return false;
  if (distM(a.pts[0], b.pts[0]) > RR.endpointM || distM(a.pts.at(-1)!, b.pts.at(-1)!) > RR.endpointM) return false;
  const ra = resample(a.pts);
  const rb = resample(b.pts);
  if (ra.length !== rb.length || !ra.length) return false;
  let sum = 0;
  for (let i = 0; i < ra.length; i++) {
    const d = distM(ra[i], rb[i]);
    if (d > RR.maxM) return false;
    sum += d;
  }
  return sum / ra.length <= RR.meanM;
}
