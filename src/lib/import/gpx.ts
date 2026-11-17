/** GPX: puntos, distancia, desnivel, simplificación y polyline. */

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
  /** ms desde epoch, o null si el punto no trae hora. */
  time: number | null;
}

export function parseGpx(xml: string): GpxPoint[] {
  const pts: GpxPoint[] = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? m[3] ?? "";
    const body = m[2] ?? "";
    const lat = Number(/lat="([^"]+)"/.exec(attrs)?.[1]);
    const lon = Number(/lon="([^"]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleS = /<ele>([^<]+)<\/ele>/.exec(body)?.[1];
    const timeS = /<time>([^<]+)<\/time>/.exec(body)?.[1];
    const ele = eleS !== undefined && Number.isFinite(Number(eleS)) ? Number(eleS) : null;
    const t = timeS ? Date.parse(timeS) : NaN;
    pts.push({ lat, lon, ele, time: Number.isFinite(t) ? t : null });
  }
  return pts;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distancia acumulada (m) en cada punto. */
export function cumulativeDistance(pts: GpxPoint[]): number[] {
  const out = new Array<number>(pts.length);
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) d += haversine(pts[i - 1], pts[i]);
    out[i] = d;
  }
  return out;
}

/** Desnivel positivo y negativo, ignorando oscilaciones menores que `threshold` m. */
export function elevationGainLoss(eles: (number | null)[], threshold = 1): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let ref: number | null = null;
  for (const e of eles) {
    if (e === null) continue;
    if (ref === null) {
      ref = e;
      continue;
    }
    const diff = e - ref;
    if (diff >= threshold) {
      gain += diff;
      ref = e;
    } else if (diff <= -threshold) {
      loss -= diff;
      ref = e;
    }
  }
  return { gain, loss };
}

export function bbox(pts: GpxPoint[]) {
  let minLat = Infinity,
    minLon = Infinity,
    maxLat = -Infinity,
    maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}

/** Douglas–Peucker en metros (proyección equirectangular local). */
export function simplify(pts: { lat: number; lon: number }[], toleranceM = 4): { lat: number; lon: number }[] {
  if (pts.length <= 2) return pts.slice();
  const lat0 = rad(pts[0].lat);
  const xy = pts.map((p) => [rad(p.lon) * Math.cos(lat0) * R, rad(p.lat) * R] as const);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx - px;
      const qy = ay + t * dy - py;
      const d = qx * qx + qy * qy;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Polyline de Google (precisión 5). */
export function encodePolyline(pts: { lat: number; lon: number }[]): string {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = "";
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return r + String.fromCharCode(s + 63);
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    out += enc(lat - pLat) + enc(lon - pLon);
    pLat = lat;
    pLon = lon;
  }
  return out;
}

export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0,
    lat = 0,
    lon = 0;
  const dec = () => {
    let shift = 0,
      result = 0,
      b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += dec();
    lon += dec();
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
