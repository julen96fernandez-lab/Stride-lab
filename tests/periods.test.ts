import { describe, expect, it } from "vitest";
import { buildPeriods, compareLast, goalProgress, localDay, suggestGoals, type RunForPeriod } from "@/lib/analysis/periods";

const run = (iso: string, km: number, min: number, o: Partial<RunForPeriod> = {}): RunForPeriod => ({
  startAt: new Date(iso),
  distanceM: km * 1000,
  durationS: min * 60,
  avgHr: null,
  isSpecial: false,
  elevationGainM: null,
  trainingLoad: null,
  hrZoneSeconds: null,
  ...o,
});

// Miércoles 18-nov-2026, 12:00 en Madrid
const NOW = new Date("2026-11-18T11:00:00Z");

describe("periodos", () => {
  it("semana de lunes a domingo en hora de Madrid", () => {
    const p = buildPeriods(
      [
        run("2026-11-15T22:30:00Z", 5, 30), // domingo 15 a las 23:30 en Madrid → semana anterior
        run("2026-11-15T23:30:00Z", 6, 30), // lunes 16 a las 00:30 en Madrid → semana actual
      ],
      "week",
      2,
      NOW,
    );
    expect(p.map((x) => x.start)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(p[0].km).toBe(5);
    expect(p[1]).toMatchObject({ km: 6, current: true, runs: 1 });
  });

  it("especiales cuentan en km pero no en el ritmo; FC ponderada; sumas de desnivel, carga y zonas", () => {
    const [m] = buildPeriods(
      [
        run("2026-11-02T08:00:00Z", 10, 50, { avgHr: 140, elevationGainM: 50, trainingLoad: 100, hrZoneSeconds: [0, 3000, 0, 0, 0] }),
        run("2026-11-05T08:00:00Z", 5, 45, { isSpecial: true, avgHr: 160, trainingLoad: 80, hrZoneSeconds: [0, 0, 0, 2700, 0] }),
      ],
      "month",
      1,
      NOW,
    );
    expect(m.km).toBe(15);
    expect(m.paceSPerKm).toBe(300); // solo la no especial: 50 min / 10 km
    expect(m.avgHr).toBeCloseTo((140 * 3000 + 160 * 2700) / 5700, 5);
    expect(m.elevationGainM).toBe(50);
    expect(m.load).toBe(180);
    expect(m.zoneSeconds).toEqual([0, 3000, 0, 2700, 0]);
  });

  it("periodos sin carreras aparecen a cero y sin ritmo", () => {
    const p = buildPeriods([run("2026-01-10T08:00:00Z", 8, 40)], "month", 12, NOW);
    expect(p).toHaveLength(12);
    expect(p[0].start).toBe("2025-12-01");
    expect(p[1].km).toBe(8);
    expect(p[5]).toMatchObject({ km: 0, runs: 0, paceSPerKm: null, avgHr: null, load: null });
  });

  it("comparación con el periodo anterior", () => {
    const c = compareLast(
      buildPeriods([run("2026-10-10T08:00:00Z", 20, 110), run("2026-11-10T08:00:00Z", 15, 75)], "month", 2, NOW),
    )!;
    expect(c.kmDelta).toBe(-5);
    expect(c.paceDeltaS).toBeCloseTo(300 - 330, 5); // más rápido ahora
  });
});

describe("objetivos", () => {
  it("progreso de la semana y km/día necesarios (hoy incluido)", () => {
    const g = goalProgress(30, 12, "week", NOW);
    expect(g.daysLeft).toBe(5); // mié, jue, vie, sáb, dom
    expect(g.remainingKm).toBe(18);
    expect(g.kmPerDay).toBeCloseTo(3.6, 5);
    expect(g.pct).toBeCloseTo(0.4, 5);
    expect(goalProgress(30, 35, "week", NOW)).toMatchObject({ remainingKm: 0, kmPerDay: 0, pct: 1 });
  });

  it("progreso del mes", () => {
    expect(goalProgress(100, 40, "month", NOW).daysLeft).toBe(13); // 18 al 30 de noviembre
  });

  it("sugerencias desde los últimos 12 meses", () => {
    const runs = Array.from({ length: 52 }, (_, i) => run(new Date(NOW.getTime() - (i * 7 + 1) * 86_400_000).toISOString(), 20, 100));
    expect(suggestGoals(runs, NOW)).toEqual({ week: 20, month: 87, year: 1040 });
  });

  it("día local en Madrid", () => {
    expect(localDay(new Date("2026-03-29T00:30:00Z")) - localDay(new Date("2026-03-28T22:30:00Z"))).toBe(1); // cambio de hora
  });
});
