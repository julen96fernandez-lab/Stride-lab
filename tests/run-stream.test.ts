import { describe, expect, it } from "vitest";
import {
  buildStream,
  gradeAdjustedPace,
  gradeAlong,
  gridStep,
  isCoarse,
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
    expect(s.ele![0]).toBeCloseTo(10, 6);
    expect(s.gap).not.toBeNull();
  });

  it("la pista se reduce a un punto cada ≥ 2 s y conserva el último", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ lat: 43, lon: -3, ele: null, time: i * 1000 }));
    const tr = reduceTrack(pts, 0, 2)!;
    expect(tr.t).toEqual([0, 2, 4, 6, 8, 10]);
    expect(reduceTrack([{ lat: 1, lon: 1, ele: null, time: null }], 0)).toBeNull();
  });
});
