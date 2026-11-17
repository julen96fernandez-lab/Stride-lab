import { describe, expect, it } from "vitest";
import { bestEfforts, continuousSegments, improvementPct, isImplausibleSample, MAX_SPEED_MPS, recordProgression } from "@/lib/analysis/best-efforts";

/** Muestras cada `step` s a velocidades por tramos: [segundos, m/s][] */
function samples(parts: [number, number][], step = 3, pauseAfter?: { at: number; gap: number }) {
  const t: number[] = [];
  const v: number[] = [];
  let now = 0;
  let paused = false;
  for (const [secs, speed] of parts) {
    for (let s = 0; s < secs; s += step) {
      now += step;
      if (pauseAfter && !paused && now > pauseAfter.at) {
        now += pauseAfter.gap; // hueco sin muestras
        paused = true;
      }
      t.push(now);
      v.push(speed * step);
    }
  }
  return { t, v };
}

describe("mejor esfuerzo dentro de una carrera", () => {
  it("encuentra el tramo rápido en medio de una carrera (interpolando)", () => {
    // 15 min a 3 m/s, 1000 m a 4 m/s (250 s), 15 min a 3 m/s → 6,4 km
    const { t, v } = samples([
      [900, 3],
      [250, 4],
      [900, 3],
    ]);
    const e = bestEfforts(t, v);
    const k1 = e.find((x) => x.key === "1k")!;
    expect(k1.timeS).toBeCloseTo(250, 0);
    expect(k1.startS).toBeCloseTo(900, -1);
    // 5 km: 1000 m a 4 m/s + 4000 m a 3 m/s ≈ 250 + 1333 s
    expect(e.find((x) => x.key === "5k")!.timeS).toBeCloseTo(250 + 4000 / 3, -1);
    expect(e.find((x) => x.key === "10k")).toBeUndefined(); // no hay 10 km
  });

  it("una pausa de más de 15 s parte la carrera: el esfuerzo no puede cruzarla", () => {
    // 2 × 3 km a 4 m/s con una pausa de 120 s en medio
    const { t, v } = samples([[1500, 4]], 3, { at: 750, gap: 120 });
    expect(continuousSegments(t, v)).toHaveLength(2);
    const e = bestEfforts(t, v);
    expect(e.find((x) => x.key === "1k")!.timeS).toBeCloseTo(250, 0);
    expect(e.find((x) => x.key === "5k")).toBeUndefined(); // 6 km en total, pero ningún tramo llega a 5
  });

  it("una pausa corta (≤ 15 s) no parte la carrera", () => {
    const { t, v } = samples([[1500, 4]], 3, { at: 750, gap: 9 });
    expect(continuousSegments(t, v)).toHaveLength(1);
    expect(bestEfforts(t, v).find((x) => x.key === "5k")).toBeDefined();
  });

  it("muestras largas y continuas (cada 60 s) no son pausas", () => {
    const { t, v } = samples([[1800, 3]], 60);
    expect(continuousSegments(t, v)).toHaveLength(1);
    expect(bestEfforts(t, v).find((x) => x.key === "5k")!.timeS).toBeCloseTo(5000 / 3, 0);
  });

  it("descarta esfuerzos imposibles (más rápido de 2:30 /km)", () => {
    const { t, v } = samples([
      [300, 3],
      [60, 20], // salto de GPS: 1,2 km en 1 min
      [300, 3],
    ]);
    expect(bestEfforts(t, v).find((x) => x.key === "1k")).toBeUndefined();
  });

  it("todas las distancias, incluida la milla y la media", () => {
    const { t, v } = samples([[7200, 3]]); // 21,6 km a 3 m/s
    const keys = bestEfforts(t, v).map((x) => x.key);
    expect(keys).toEqual(["1k", "1mi", "5k", "10k", "half"]);
    const half = bestEfforts(t, v).find((x) => x.key === "half")!;
    expect(half.timeS).toBeCloseTo(21097.5 / 3, 0);
  });
});

describe("evolución de los récords", () => {
  const e = (iso: string, timeS: number) => ({ runId: iso, startAt: new Date(iso), key: "5k" as const, timeS });
  it("marca cuándo se batió el récord y calcula la mejora", () => {
    const p = recordProgression([e("2024-05-01", 1500), e("2023-01-01", 1560), e("2025-01-01", 1520), e("2026-03-01", 1440)]);
    expect(p.map((x) => x.isRecord)).toEqual([true, true, false, true]);
    expect(improvementPct(p)).toBeCloseTo(((1560 - 1440) / 1560) * 100, 5);
    expect(improvementPct(recordProgression([e("2024-05-01", 1500)]))).toBeNull();
  });
});

describe("muestras anómalas (velocidad implícita imposible)", () => {
  // Carrera real del 4-jul-2026 (21,4 km, parciales 5:16–8:46 /km): muestras finas casi paradas
  // hasta t=3000 s y, a t=3105, una muestra de 886,4 m con solo 105 s de hueco (8,44 m/s). Antes
  // daba un «1 km en 2:32». Después, el reloj sigue con muestras de ~305 s a ~2,2 m/s.
  const realistic = () => {
    const t: number[] = [];
    const v: number[] = [];
    // 0–2883 s: carrera a 2,6 m/s en muestras de 3 s
    for (let s = 3; s <= 2883; s += 3) {
      t.push(s);
      v.push(7.8);
    }
    // muestras finas casi paradas (como las reales) hasta 3000 s
    for (const [tt, vv] of [[2906, 3.4], [2908, 3.2], [2911, 1.7], [2913, 4.7], [2916, 5.7], [2931, 1.3], [2936, 6.8], [2970, 6.4], [2985, 2.6], [3000, 10.0]]) {
      t.push(tt);
      v.push(vv);
    }
    t.push(3105, 3410, 3715, 4020, 4324);
    v.push(886.4, 737.1, 612.6, 624.0, 698.5);
    return { t, v };
  };

  it("la muestra anómala no es continua: parte el tramo antes y después", () => {
    const { t, v } = realistic();
    const segs = continuousSegments(t, v);
    expect(v[t.indexOf(3105)] / (3105 - 3000)).toBeGreaterThan(MAX_SPEED_MPS);
    // ningún tramo contiene la muestra de 886 m: el último tramo empieza donde ella termina
    for (const s of segs) expect(s.t.some((x, k) => k > 0 && s.d[k] - s.d[k - 1] > 800)).toBe(false);
    expect(segs.some((s) => s.t.includes(3000) && s.t.includes(3105))).toBe(false);
    expect(segs.at(-1)!.t[0]).toBe(3105);
    expect(segs.at(-1)!.d[1]).toBeCloseTo(737.1, 5);
  });

  it("el 1 km más rápido es coherente con la carrera (nunca 2:32)", () => {
    const { t, v } = realistic();
    const k1 = bestEfforts(t, v).find((e) => e.key === "1k")!;
    expect(k1.timeS).toBeGreaterThan(300); // ~2,6 m/s → ~6:25 /km, no 2:32
    expect(k1.startS).not.toBe(3000);
  });

  it("5 km de 2021: 1250 m en 20 s en la 2.ª muestra de la carrera no se usa", () => {
    // 1.ª muestra a 621 s con 80 m; 2.ª a 641 s con 1250,3 m (62 m/s); después 4 m/s a 3 s
    const t = [621, 641];
    const v = [80, 1250.3];
    for (let s = 644; s <= 2200; s += 3) {
      t.push(s);
      v.push(12); // 4 m/s → 4:10 /km
    }
    const k5 = bestEfforts(t, v).find((e) => e.key === "5k")!;
    expect(k5.timeS / 5).toBeGreaterThanOrEqual(249); // 4:10 /km, no 3:23
    expect(k5.startS).toBeGreaterThanOrEqual(641);
  });

  it("muestras de 2–3 s con 14–17 m (redondeo de segundos) no se tocan", () => {
    const t: number[] = [];
    const v: number[] = [];
    for (let s = 2; s <= 1200; s += 2) {
      t.push(s);
      v.push(s % 8 === 0 ? 17 : 6); // media ~ 5,7 m/s → picos de 8,5 m/s
    }
    expect(continuousSegments(t, v)).toHaveLength(1);
    expect(bestEfforts(t, v).some((e) => e.key === "1k")).toBe(true);
  });

  it("una muestra larga y plausible (305 s a 2,4 m/s) sigue siendo válida", () => {
    const t = [305, 610, 915, 1220, 1525];
    const v = [732, 732, 732, 732, 732];
    expect(continuousSegments(t, v)).toHaveLength(1);
  });

  // Las que se escaparon del primer umbral (7 m/s): mismas carreras reales.
  it("muestras largas con hueco corto detrás de muestras finas son inválidas aunque no pasen de 7 m/s", () => {
    expect(isImplausibleSample(945.5, 141, 20)).toBe(true); // 4-jul: 6,71 m/s → daba un 1 km en 2:38
    expect(isImplausibleSample(1303.7, 203, 2)).toBe(true); // 24-ago-2021: 6,42 m/s → daba un 1 km en 2:36
    expect(isImplausibleSample(801, 179, 3)).toBe(true); // 4-jul: 4,48 m/s
    expect(isImplausibleSample(929, 236, 3)).toBe(true); // 4-jul: 3,94 m/s → daba un 1 km en 4:19 (parciales: 5:16)
    expect(isImplausibleSample(1250.3, 20, 621)).toBe(true); // 13-jun-2021: 62 m/s
    expect(isImplausibleSample(1160.6, 142, 637)).toBe(true); // 14-ene-2024: 8,17 m/s → daba una milla en 4:30
  });

  it("las muestras completas, las finales cortas tras una completa y los ritmos normales son válidos", () => {
    expect(isImplausibleSample(737.1, 305, 305)).toBe(false); // 2,4 m/s
    expect(isImplausibleSample(1198, 278, 306)).toBe(false); // 4,3 m/s en una muestra casi completa
    expect(isImplausibleSample(937, 237, 306)).toBe(false); // última muestra, más corta, tras una completa
    expect(isImplausibleSample(659, 167, 306)).toBe(false);
    expect(isImplausibleSample(1000, 270, 2)).toBe(false); // hueco completo
    expect(isImplausibleSample(2000, 270, 306)).toBe(true); // 7,4 m/s: ni una muestra completa lo aguanta
    expect(isImplausibleSample(17.1, 2, 3)).toBe(false); // redondeo de segundos
    expect(isImplausibleSample(60, 9, 3)).toBe(false); // hueco < 10 s: no se juzga
    expect(isImplausibleSample(250, 200, 2)).toBe(false); // < 300 m: muestra pequeña (pausa), la tratan las pausas
    expect(isImplausibleSample(700, 105)).toBe(false); // primera muestra de la carrera (sin anterior)
  });

  it("carrera con las tres anomalías del 4-jul: ningún esfuerzo las cruza y ninguno baja de ritmo creíble", () => {
    // 3 000 s a 2,6 m/s (muestras de 3 s), muestra anómala (946 m en 141 s), 600 s más, otra (801 m en 179 s), 600 s más
    const t: number[] = [];
    const v: number[] = [];
    let now = 0;
    const run = (secs: number) => {
      for (let s = 0; s < secs; s += 3) {
        now += 3;
        t.push(now);
        v.push(7.8);
      }
    };
    run(3000);
    now += 141;
    t.push(now);
    v.push(945.5);
    run(600);
    now += 179;
    t.push(now);
    v.push(801);
    run(600);
    const segs = continuousSegments(t, v);
    expect(segs).toHaveLength(3);
    for (const s of segs) expect(s.t.some((_, k) => k > 0 && s.d[k] - s.d[k - 1] > 700)).toBe(false);
    const e = bestEfforts(t, v);
    expect(e.find((x) => x.key === "1k")!.timeS).toBeGreaterThan(380); // 2,6 m/s → ~6:25 /km
  });
});
