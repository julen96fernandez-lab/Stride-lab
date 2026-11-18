import { describe, expect, it } from "vitest";
import {
  buildStream,
  gradeAdjustedPace,
  gradeAlong,
  gridStep,
  isCoarse,
  hrAxisFrom60,
  missingDistance,
  noDataRanges,
  preferGpsKm,
  cleanPace,
  hrCoverage,
  hrSegments,
  isHrSparse,
  nearestWithin,
  paceAxisRange,
  rollingMedian,
  niceXStep,
  minettiCost,
  nearestIndex,
  reduceTrack,
  sampleAt,
  smoothSpeed,
  splitViews,
} from "@/lib/analysis/run-stream";
import { DEFAULT_ZONES } from "@/lib/analysis/hr-zones";

/** Muestras de distancia cada `step` s a `mps` durante `secs` s (t = final de cada intervalo). */
function steady(secs: number, mps: number, step = 3, t0 = 0) {
  const t: number[] = [];
  const v: number[] = [];
  for (let s = t0 + step; s <= t0 + secs; s += step) {
    t.push(s);
    v.push(mps * step);
  }
  return { t, v };
}

describe("búsqueda del punto más cercano", () => {
  const xs = [0, 3, 6, 10, 20];
  it("devuelve el índice más cercano, con los extremos y empates", () => {
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 4)).toBe(1);
    expect(nearestIndex(xs, 5)).toBe(2);
    expect(nearestIndex(xs, 4.5)).toBe(1); // empate: el anterior
    expect(nearestIndex(xs, 14)).toBe(3);
    expect(nearestIndex(xs, 16)).toBe(4);
    expect(nearestIndex(xs, 99)).toBe(4);
    expect(nearestIndex([], 3)).toBe(-1);
  });

  it("coincide con una búsqueda lineal en 2 000 valores", () => {
    const big = Array.from({ length: 2000 }, (_, i) => i * 2.7 + (i % 3) * 0.1);
    for (const x of [0.4, 100.01, 2711.3, 5000, 5397.2]) {
      let best = 0;
      big.forEach((v, i) => {
        if (Math.abs(v - x) < Math.abs(big[best] - x)) best = i;
      });
      expect(nearestIndex(big, x)).toBe(best);
    }
  });
});

describe("valor de una serie en un instante", () => {
  const s = { t: [0, 10, 20, 200], v: [100, 120, 140, 160] };
  it("interpola entre muestras cercanas", () => {
    expect(sampleAt(s, 5, 30)).toBe(110);
    expect(sampleAt(s, 10, 30)).toBe(120);
  });
  it("no inventa nada en un hueco grande", () => {
    expect(sampleAt(s, 100, 30)).toBeNull();
    expect(sampleAt(s, 30, 30)).toBe(140); // cerca de la muestra de 20 s
    expect(sampleAt(s, 500, 30)).toBeNull();
  });
});

describe("ritmo suavizado", () => {
  it("a velocidad constante da exactamente ese ritmo", () => {
    const d = steady(600, 3.2);
    const v = smoothSpeed(d, [60, 300, 540], 30);
    for (const x of v) expect(x).toBeCloseTo(3.2, 6);
  });

  it("suaviza un cambio brusco en una ventana de ~30 s", () => {
    const a = steady(300, 3);
    const b = steady(300, 4, 3, 300);
    const d = { t: [...a.t, ...b.t], v: [...a.v, ...b.v] };
    const [before, at, after] = smoothSpeed(d, [270, 300, 330], 30);
    expect(before).toBeCloseTo(3, 6);
    expect(at).toBeCloseTo(3.5, 1); // mitad y mitad
    expect(after).toBeCloseTo(4, 6);
  });

  it("no hay ritmo durante una pausa ni cruzándola", () => {
    const a = steady(300, 3);
    // pausa de 60 s: la muestra que la cierra cubre 2 m
    const d = { t: [...a.t, 360, ...steady(300, 3, 3, 360).t], v: [...a.v, 2, ...steady(300, 3, 3, 360).v] };
    const v = smoothSpeed(d, [330, 345], 30);
    expect(v).toEqual([null, null]);
    expect(smoothSpeed(d, [200], 30)[0]).toBeCloseTo(3, 6);
  });

  it("una muestra de distancia imposible no dibuja un pico (mismas reglas que los récords)", () => {
    // Caso real del 4-jul: muestras finas casi paradas y una de 886 m con 105 s de hueco.
    const a = steady(2880, 2.6);
    const t = [...a.t, 2900, 2920, 2940, 2960, 2980, 3000, 3105, 3410, 3715];
    const v = [...a.v, 1, 1, 1, 1, 1, 10, 886.4, 737.1, 612.6];
    const speeds = smoothSpeed({ t, v }, Array.from({ length: 300 }, (_, i) => 2700 + i * 3), 30).filter((x): x is number => x !== null);
    expect(Math.max(...speeds)).toBeLessThan(3.5); // nunca 8 m/s
  });

  it("parado (< 0,66 m/s) no tiene ritmo", () => {
    const d = steady(300, 0.3);
    expect(smoothSpeed(d, [150], 30)[0]).toBeNull();
  });

  it("carreras antiguas con muestras cada 5 min: ritmo por parciales, no curva", () => {
    expect(isCoarse({ t: [306, 612, 918, 1224], v: [1100, 1100, 1100, 1100] })).toBe(true);
    expect(isCoarse(steady(600, 3))).toBe(false);
    expect(isCoarse(null)).toBe(true);
    const s = buildStream({ durationS: 1224, distance: { t: [306, 612, 918, 1224], v: [1100, 1100, 1100, 1100] } });
    expect(s.coarsePace).toBe(true);
    expect(s.pace.every((p) => p === null)).toBe(true);
    expect(s.gap).toBeNull();
  });
});

describe("ritmo ajustado por pendiente (GAP)", () => {
  it("coste de Minetti: 3,6 J/kg/m en llano, más subiendo, menos bajando suave", () => {
    expect(minettiCost(0)).toBeCloseTo(3.6, 6);
    expect(minettiCost(0.1)).toBeGreaterThan(5);
    expect(minettiCost(-0.1)).toBeLessThan(3.6);
    expect(minettiCost(-0.4)).toBeGreaterThan(minettiCost(-0.2)); // bajada muy fuerte cuesta más
    expect(minettiCost(0.9)).toBe(minettiCost(0.45)); // limitado al rango del modelo
  });

  it("subiendo, el GAP es más rápido que el ritmo real; en llano, igual", () => {
    expect(gradeAdjustedPace(360, 0)).toBeCloseTo(360, 6);
    const up = gradeAdjustedPace(360, 0.08);
    expect(up).toBeLessThan(300); // 6:00 /km al 8 % equivale a menos de 5:00 en llano
    expect(gradeAdjustedPace(300, -0.05)).toBeGreaterThan(300);
  });

  it("pendiente a lo largo de la distancia (ventana de ±50 m)", () => {
    const dist = Array.from({ length: 101 }, (_, i) => i * 10); // 0…1000 m
    const ele = dist.map((d) => 100 + d * 0.05); // 5 %
    const g = gradeAlong(dist, ele);
    expect(g[50]).toBeCloseTo(0.05, 6);
    expect(gradeAlong([0, 5, 10], [1, 2, 3])[1]).toBeNull(); // < 20 m: sin pendiente
    expect(gradeAlong([0, 100], [null, null])).toEqual([null, null]);
  });

  it("sin altitud no hay GAP", () => {
    const s = buildStream({ durationS: 600, distance: steady(600, 3) });
    expect(s.gap).toBeNull();
    expect(s.ele).toBeNull();
  });
});

describe("parciales", () => {
  const rows = [
    { idx: 1, distanceM: 1000, durationS: 300, paceSPerKm: 300, avgHr: 150, elevationGainM: 5 },
    { idx: 2, distanceM: 1000, durationS: 280, paceSPerKm: 280, avgHr: 155, elevationGainM: 2 },
    { idx: 3, distanceM: 1000, durationS: 330, paceSPerKm: 330, avgHr: 152, elevationGainM: 20 },
    { idx: 4, distanceM: 400, durationS: 100, paceSPerKm: 250, avgHr: 160, elevationGainM: 0 }, // incompleto
  ];
  const v = splitViews(rows, 4);

  it("tramo de tiempo de cada parcial, seguidos desde la primera muestra", () => {
    expect(v.map((s) => [s.t0, s.t1])).toEqual([
      [4, 304],
      [304, 584],
      [584, 914],
      [914, 1014],
    ]);
  });

  it("marca el más rápido y el más lento; el último incompleto no compite", () => {
    expect(v.map((s) => s.fastest)).toEqual([false, true, false, false]);
    expect(v.map((s) => s.slowest)).toEqual([false, false, true, false]);
    expect(v[3].partial).toBe(true);
  });

  it("barra relativa: 1 el más rápido, 0,35 el más lento", () => {
    expect(v[1].bar).toBeCloseTo(1, 6);
    expect(v[2].bar).toBeCloseTo(0.35, 6);
    expect(v[0].bar).toBeGreaterThan(0.35);
    expect(v[0].bar).toBeLessThan(1);
    expect(v[3].bar).toBeCloseTo(1, 6); // más rápido que todos: se limita a 1
  });

  it("todos al mismo ritmo (al segundo): ni más rápido ni más lento, barras completas", () => {
    const same = splitViews([0, 1, 2].map((k) => ({ ...rows[0], idx: k + 1, paceSPerKm: 286 + k * 0.2 })));
    expect(same.some((s) => s.fastest || s.slowest)).toBe(false);
    expect(same.every((s) => s.bar === 1)).toBe(true);
  });

  it("un solo parcial completo: sin marcas", () => {
    const one = splitViews([rows[0]]);
    expect(one[0].fastest || one[0].slowest).toBe(false);
  });
});

describe("línea de tiempo común", () => {
  it("marcas redondas del eje X", () => {
    expect(niceXStep(21.34, "dist")).toBe(5);
    expect(niceXStep(4.5, "dist")).toBe(1);
    expect(niceXStep(6101, "time")).toBe(1800); // cada 30 min
    expect(niceXStep(1500, "time")).toBe(300);
  });

  it("rejilla de ~3 s y como mucho ~1500 puntos", () => {
    expect(gridStep(1800)).toBe(3);
    expect(gridStep(6100)).toBe(5);
    expect(gridStep(30000)).toBe(20);
  });

  it("solo hay las series que existen; pulso con zona", () => {
    const s = buildStream({
      durationS: 600,
      distance: steady(600, 3),
      hr: { t: Array.from({ length: 120 }, (_, i) => i * 5), v: Array.from({ length: 120 }, () => 150) },
      zones: DEFAULT_ZONES,
    });
    expect(s.power).toBeNull();
    expect(s.ele).toBeNull();
    expect(s.trackIdx).toBeNull();
    expect(s.hr!.filter((h) => h !== null).every((h) => h === 150)).toBe(true);
    expect(new Set(s.zone!.filter((z) => z !== null))).toEqual(new Set([3])); // 150 ppm con 47/187 → Z3
    expect(s.km.at(-1)).toBeCloseTo(1.8, 6);
    expect(s.avgPace).toBeNull();
  });

  it("con pista GPS: índice del punto del mapa y altitud", () => {
    const track = reduceTrack(
      Array.from({ length: 301 }, (_, i) => ({ lat: 43 + i * 1e-5, lon: -3, ele: 10 + i * 0.1, time: 1_000_000 + i * 2000 })),
      1_000_000,
      2,
    )!;
    const s = buildStream({ durationS: 600, distance: steady(600, 3), track });
    expect(s.trackIdx!.length).toBe(s.t.length);
    expect(track.t[s.trackIdx![10]]).toBeCloseTo(s.t[10], 0);
    expect(s.ele![0]).toBeCloseTo(10, 0); // suavizada
    expect(s.gap).not.toBeNull();
  });

  it("la pista se reduce a un punto cada ≥ 2 s y conserva el último", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ lat: 43, lon: -3, ele: null, time: i * 1000 }));
    const tr = reduceTrack(pts, 0, 2)!;
    expect(tr.t).toEqual([0, 2, 4, 6, 8, 10]);
    expect(reduceTrack([{ lat: 1, lon: 1, ele: null, time: null }], 0)).toBeNull();
  });
});

describe("limpieza para dibujar", () => {
  it("la mediana quita un pico suelto que la media sola arrastraría", () => {
    const p = [300, 301, 299, 300, 120, 300, 302, 300, 299, 301];
    expect(rollingMedian(p, 5)[4]).toBe(300);
    const c = cleanPace(p);
    expect(Math.min(...c.filter((x): x is number => x !== null))).toBeGreaterThan(295); // sin el 2:00
  });

  it("nada más rápido de 2:30 /km se dibuja; los huecos siguen siendo huecos", () => {
    const c = cleanPace([140, 140, 140, 140, 140, 140, 140, null, 300]);
    expect(c.slice(0, 7).every((x) => x === null)).toBe(true);
    expect(c[7]).toBeNull();
  });

  it("pulso: corte donde hay más de 2 min entre muestras (sin rayas ni ceros)", () => {
    const s = hrSegments({ t: [0, 5, 10, 400, 405], v: [140, 141, 142, 150, 151] });
    expect(s.v).toEqual([140, 141, 142, null, 150, 151]);
    expect(s.t[3]).toBe(205);
    expect(s.v.includes(0)).toBe(false);
  });

  it("pulso escaso → por parciales; denso → curva", () => {
    const dense = { t: Array.from({ length: 600 }, (_, i) => i * 5), v: Array(600).fill(150) };
    expect(hrCoverage(dense, 3000)).toBeCloseTo(1, 2);
    expect(isHrSparse(dense, 3000)).toBe(false);
    // 4-jul: muestras cada 5 s, pero solo en una parte; el resto, huecos de 10–20 min
    const sparse = { t: [...Array.from({ length: 40 }, (_, i) => i * 5), 1400, 2600, 3800, 5000], v: Array(44).fill(140) };
    expect(isHrSparse(sparse, 9000)).toBe(true);
    expect(isHrSparse(null, 1000)).toBe(true);
  });

  it("valor de la muestra más cercana a ≤ 60 s (con su distancia), si no, nada", () => {
    const s = { t: [0, 100, 300], v: [130, 140, 150] };
    expect(nearestWithin(s, 130)).toEqual({ v: 140, dt: 30 });
    expect(nearestWithin(s, 200)).toBeNull(); // a 100 s de las dos
    expect(nearestWithin(null, 1)).toBeNull();
  });

  it("eje de ritmo: percentiles 5–95, marcas cada 30 s o 1 min, sin estirarse por minutos de caminar", () => {
    const paces = [...Array(95).fill(0).map((_, i) => 300 + (i % 20)), 840, 840, 900, 900, 850]; // 5 % a 14:00
    const a = paceAxisRange(paces)!;
    expect(a.interval).toBe(30);
    expect(a.min).toBeLessThanOrEqual(300);
    expect(a.max).toBeLessThan(840); // no llega a 14:00
    expect(a.min % 30).toBe(0);
    const wide = paceAxisRange([270, 300, 360, 420, 480])!;
    expect(wide.interval).toBe(60);
    expect(paceAxisRange([null, null])).toBeNull();
  });

  it("altitud sin cortes: rellena huecos de la pista de hasta 10 min", () => {
    const t = [...Array.from({ length: 100 }, (_, i) => i * 3), ...Array.from({ length: 100 }, (_, i) => 700 + i * 3)]; // hueco de 400 s
    const track = { t, lat: t.map(() => 43), lon: t.map(() => -3), ele: t.map((x) => 10 + x / 100) };
    const st = buildStream({ durationS: 1000, track });
    const mid = st.ele!.filter((_, i) => st.t[i] > 300 && st.t[i] < 700);
    expect(mid.every((e) => e !== null)).toBe(true);
  });
});

describe("distancia que el reloj no registró (4-jul)", () => {
  // Pista a 2,6 m/s todo el rato; el reloj registra hasta 2504 s, luego 3 m en 256 s (pero el
  // GPS marca ~660 m) y después sigue normal.
  const track = { t: [] as number[], lat: [] as number[], lon: [] as number[], ele: [] as (number | null)[] };
  for (let t = 0; t <= 3600; t += 2) {
    track.t.push(t);
    track.lat.push(43 + (t * 2.6) / 111_195);
    track.lon.push(-3);
    track.ele.push(null);
  }
  const dt: number[] = [];
  const dv: number[] = [];
  for (let t = 3; t <= 2504; t += 3) {
    dt.push(t);
    dv.push(7.8);
  }
  dt.push(2760);
  dv.push(3);
  for (let t = 2763; t <= 3600; t += 3) {
    dt.push(t);
    dv.push(7.8);
  }
  const distance = { t: dt, v: dv };

  it("localiza el tramo y cuánto marca el GPS", () => {
    const m = missingDistance(distance, track);
    expect(m).toHaveLength(1);
    expect(m[0].t0).toBe(2502);
    expect(m[0].t1).toBe(2760);
    expect(m[0].gpsM).toBeCloseTo(258 * 2.6, -1);
    expect(m[0].watchM).toBe(3);
  });

  it("una pausa real (el GPS tampoco se mueve) no cuenta", () => {
    // Parado de 2504 a 2760 s y después sigue desde el mismo sitio.
    const pos = (t: number) => 43 + ((t <= 2504 ? t : t < 2760 ? 2504 : t - 256) * 2.6) / 111_195;
    const still = { ...track, lat: track.t.map(pos) };
    expect(missingDistance(distance, still)).toHaveLength(0);
  });

  it("eje de km del GPS solo si cuadra mejor con el total", () => {
    expect(preferGpsKm(20654, 21308, 21379)).toBe(true); // 4-jul
    expect(preferGpsKm(21340, 21300, 21340)).toBe(false); // las muestras ya cuadran
    expect(preferGpsKm(20000, 23000, 21379)).toBe(false); // el GPS tampoco
    expect(preferGpsKm(null, 21000, 21000)).toBe(false);
  });

  it("con el eje del GPS, el último km llega al total", () => {
    const st = buildStream({ durationS: 3600, distance, track, kmFromGps: true });
    expect(st.km.at(-1)! * 1000).toBeCloseTo(3600 * 2.6, -1);
    const raw = buildStream({ durationS: 3600, distance, track });
    expect(raw.km.at(-1)! * 1000).toBeLessThan(st.km.at(-1)! * 1000 - 500);
  });

  it("bandas «sin datos»: huecos de ritmo dentro de la parte con datos", () => {
    const t = [0, 3, 6, 9, 12, 15, 18, 21];
    expect(noDataRanges(t, [null, 300, null, null, null, 310, 305, null])).toEqual([[3, 15]]);
    expect(noDataRanges(t, [300, null, 300, 300, 300, 300, 300, 300])).toEqual([]); // un punto: no
    expect(noDataRanges(t, [null, null])).toEqual([]);
  });
});

describe("eje del pulso por parciales", () => {
  it("empieza en 60 con marcas claras (no exagera diferencias)", () => {
    expect(hrAxisFrom60([121, 150, 138])).toEqual({ min: 60, max: 160, interval: 20 });
    expect(hrAxisFrom60([52, 170])).toMatchObject({ min: 40 });
    expect(hrAxisFrom60([null])).toBeNull();
  });
});
