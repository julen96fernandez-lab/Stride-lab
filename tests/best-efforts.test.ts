import { describe, expect, it } from "vitest";
import { bestEfforts, continuousSegments, improvementPct, recordProgression } from "@/lib/analysis/best-efforts";

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
