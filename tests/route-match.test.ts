import { describe, expect, it } from "vitest";
import { ROUTE_RULES, distM, pathLength, resample, sameRoute, type LatLon } from "@/lib/analysis/route-match";

// Rectángulo de ~1,2 × 0,8 km en Bilbao, recorrido en sentido horario, con un punto cada ~20 m.
const O: LatLon = [43.24, -2.92];
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((43.24 * Math.PI) / 180));
const at = (x: number, y: number): LatLon => [O[0] + y * M_LAT, O[1] + x * M_LON];
function path(corners: [number, number][], step = 20): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1];
    const [x1, y1] = corners[i];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) out.push(at(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
  }
  out.push(at(...corners.at(-1)!));
  return out;
}
const LOOP: [number, number][] = [[0, 0], [0, 800], [1200, 800], [1200, 0], [0, 0]];
const base = path(LOOP);
const len = pathLength(base);
// ruido de GPS determinista de hasta ±15 m, suave (el error del GPS va correlacionado, no en zigzag)
const noisy = (pts: LatLon[], amp = 15) => pts.map(([la, lo], i) => [la + Math.sin(i * 0.31) * amp * M_LAT, lo + Math.cos(i * 0.23) * amp * M_LON] as LatLon);
const shape = (pts: LatLon[], d: number | null = pathLength(pts)) => ({ distanceM: d, pts });

describe("misma ruta", () => {
  it("el mismo recorrido con ruido de GPS y otra densidad de puntos coincide", () => {
    expect(sameRoute(shape(base, len), shape(noisy(path(LOOP, 35)), len * 1.02))).toBe(true);
  });
  it("la ruta invertida NO cuenta (mismo inicio y fin, otro sentido)", () => {
    expect(sameRoute(shape(base), shape([...base].reverse()))).toBe(false);
  });
  it("parecida pero distinta: mismo inicio, fin y distancia, pero otra calle en medio", () => {
    // en vez de subir por x=0, sube por x=300 (300 m al lado) y vuelve: misma longitud total aprox.
    const other = path([[0, 0], [300, 0], [300, 800], [1200, 800], [1200, 0], [300, 0], [0, 0]]);
    expect(Math.abs(pathLength(other) / len - 1)).toBeLessThan(0.3);
    expect(sameRoute(shape(base), shape(other, len))).toBe(false);
  });
  it("una ruta que se aparta un tramo más de 250 m no coincide aunque la media sea baja", () => {
    const detour = path([[0, 0], [0, 800], [600, 800], [600, 1100], [620, 1100], [620, 800], [1200, 800], [1200, 0], [0, 0]]);
    expect(sameRoute(shape(base, len), shape(detour, len))).toBe(false);
  });
  it("distancia fuera del 5 %", () => {
    expect(sameRoute(shape(base, 4000), shape(base, 4300))).toBe(false);
    expect(sameRoute(shape(base, 4000), shape(base, 4150))).toBe(true);
  });
  it("inicio a más de 200 m: no", () => {
    const shifted = path([[0, 250], [0, 800], [1200, 800], [1200, 0], [0, 0]]);
    expect(sameRoute(shape(base, len), shape(shifted, len))).toBe(false);
  });
  it("trazados vacíos o de un punto: no", () => {
    expect(sameRoute(shape([]), shape(base))).toBe(false);
    expect(sameRoute(shape([O]), shape(base))).toBe(false);
  });
});

describe("utilidades", () => {
  it("distancia y longitud del trazado", () => {
    expect(distM(at(0, 0), at(0, 1000))).toBeCloseTo(1000, -1);
    expect(len).toBeCloseTo(4000, -1);
  });
  it("reparte en 50 puntos a igual distancia, del inicio al fin", () => {
    const r = resample(base);
    expect(r).toHaveLength(ROUTE_RULES.samples);
    expect(distM(r[0], base[0])).toBeLessThan(1);
    expect(distM(r.at(-1)!, base.at(-1)!)).toBeLessThan(1);
    const gaps = r.slice(1).map((p, i) => distM(r[i], p));
    // en las esquinas el paso en línea recta es algo menor que el recorrido
    for (const g of gaps) expect(g).toBeLessThan(len / 49 + 1);
  });
});
