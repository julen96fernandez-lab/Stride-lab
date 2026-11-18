import { describe, expect, it } from "vitest";
import { clockOf, halves, pacePlan, STRATEGIES } from "@/lib/race/pacing";
import type { RaceProfile } from "@/lib/race/race";

const HALF = 21097.5;
const sum = (rows: { splitS: number }[]) => rows.reduce((a, r) => a + r.splitS, 0);

/** perfil: 0–10 km llano, 10–12 km subida del 4 %, resto llano */
const hilly: RaceProfile = (() => {
  const d: number[] = [];
  const e: number[] = [];
  for (let x = 0; x <= HALF; x += 50) {
    d.push(x);
    e.push(x < 10000 ? 0 : x < 12000 ? (x - 10000) * 0.04 : 80);
  }
  return { d, e, gpxM: HALF, scale: 1, gainM: 80 };
})();

describe("plan de ritmos por km", () => {
  it("todas las estrategias, con y sin GPX, suman EXACTAMENTE el objetivo", () => {
    for (const s of STRATEGIES) for (const profile of [null, hilly]) for (const target of [5940, 6203, 3001, 1335]) {
      const rows = pacePlan({ distanceM: target === 1335 ? 5000 : HALF, targetS: target, strategy: s.key, profile });
      expect(sum(rows)).toBe(target);
      expect(rows.at(-1)!.cumS).toBe(target);
      for (const r of rows) expect(Number.isInteger(r.splitS)).toBe(true);
    }
  });
  it("tramos: kilómetros enteros y el último parcial", () => {
    const rows = pacePlan({ distanceM: HALF, targetS: 5940, strategy: "even" });
    expect(rows).toHaveLength(22);
    expect(rows.at(-1)!.lengthM).toBe(98); // 97,5 m redondeados
    expect(rows[0].lengthM).toBe(1000);
  });
  it("uniforme: el mismo ritmo en cada km (±1 s por el redondeo)", () => {
    const rows = pacePlan({ distanceM: 10000, targetS: 2700, strategy: "even" });
    for (const r of rows) expect(Math.abs(r.paceS - 270)).toBeLessThanOrEqual(1);
  });
  it("negativa 2 % y 5 %: la segunda mitad ese tanto más rápida; positiva 2 %, más lenta", () => {
    for (const [k, p] of [["neg2", -0.02], ["neg5", -0.05], ["pos2", 0.02]] as const) {
      const rows = pacePlan({ distanceM: 10000, targetS: 2700, strategy: k });
      const [a, b] = halves(rows, 10000);
      expect(b / a - 1).toBeCloseTo(p, 2);
      if (p < 0) expect(rows.at(-1)!.paceS).toBeLessThan(rows[0].paceS);
      else expect(rows.at(-1)!.paceS).toBeGreaterThan(rows[0].paceS);
    }
  });
  it("con GPX: los km de subida, más lentos; manteniendo el total", () => {
    const flat = pacePlan({ distanceM: HALF, targetS: 6000, strategy: "even" });
    const hill = pacePlan({ distanceM: HALF, targetS: 6000, strategy: "even", profile: hilly });
    expect(hill[10].paceS).toBeGreaterThan(hill[3].paceS + 10); // km 11, en plena subida
    expect(hill[3].paceS).toBeLessThan(flat[3].paceS); // para compensar, el llano algo más rápido
    expect(hill[10].grade).toBeCloseTo(0.04, 2);
    expect(sum(hill)).toBe(6000);
  });
  it("hora del día de cada paso (también pasando la medianoche)", () => {
    const rows = pacePlan({ distanceM: 5000, targetS: 1500, strategy: "even", startTime: "09:30" });
    expect(rows[0].clock).toBe("09:35:00");
    expect(rows.at(-1)!.clock).toBe("09:55:00");
    expect(clockOf(23 * 3600 + 59 * 60 + 90)).toBe("00:00:30");
    expect(pacePlan({ distanceM: 5000, targetS: 1500, strategy: "even" })[0].clock).toBeNull();
  });
});
