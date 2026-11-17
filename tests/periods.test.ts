import { describe, expect, it } from "vitest";
import { buildPeriods, compareLast, comparePeriodToDate, goalProgress, localDay, rangeLabel, suggestGoals, yearsSinceFirst, type RunForPeriod } from "@/lib/analysis/periods";

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

  it("lesión: suma km pero no cuenta en el ritmo medio", () => {
    const [m] = buildPeriods(
      [run("2026-11-02T08:00:00Z", 10, 50), run("2026-11-05T08:00:00Z", 6, 42, { inInjury: true })],
      "month",
      1,
      NOW,
    );
    expect(m.km).toBe(16);
    expect(m.paceSPerKm).toBe(300);
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

describe("comparación con el mismo tramo del periodo anterior", () => {
  it("semana: lunes→miércoles frente a lunes→miércoles de la semana pasada", () => {
    const c = comparePeriodToDate(
      [
        run("2026-11-16T08:00:00Z", 5, 30), // lun 16 (actual)
        run("2026-11-18T08:00:00Z", 7, 40), // mié 18 (actual)
        run("2026-11-09T08:00:00Z", 10, 55), // lun 9 → cuenta
        run("2026-11-11T08:00:00Z", 6, 33), // mié 11 → cuenta
        run("2026-11-12T08:00:00Z", 20, 110), // jue 12 → fuera del tramo
        run("2026-11-15T08:00:00Z", 8, 44), // dom 15 → fuera
      ],
      "week",
      NOW,
    );
    expect([c.currentFrom, c.currentTo, c.previousFrom, c.previousTo]).toEqual(["2026-11-16", "2026-11-18", "2026-11-09", "2026-11-11"]);
    expect(c.current.km).toBe(12);
    expect(c.previous.km).toBe(16); // no 44: el jueves y el domingo no cuentan
    expect(c.kmDelta).toBe(-4);
    expect(c.capped).toBe(false);
  });

  it("mes: 1–18 de noviembre frente a 1–18 de octubre (no octubre entero)", () => {
    const c = comparePeriodToDate(
      [run("2026-11-03T08:00:00Z", 10, 50), run("2026-10-17T08:00:00Z", 21, 100), run("2026-10-25T08:00:00Z", 15, 80)],
      "month",
      NOW,
    );
    expect([c.previousFrom, c.previousTo]).toEqual(["2026-10-01", "2026-10-18"]);
    expect(c.previous.km).toBe(21); // el 25 de octubre queda fuera
    expect(c.kmDelta).toBe(-11);
    expect(c.paceDeltaS).toBeCloseTo(300 - (100 * 60) / 21, 5);
  });

  it("año: 1 ene→hoy frente a 1 ene→mismo día del año anterior", () => {
    const c = comparePeriodToDate(
      [run("2026-02-01T08:00:00Z", 10, 50), run("2025-11-17T08:00:00Z", 12, 60), run("2025-11-19T08:00:00Z", 30, 150), run("2025-12-20T08:00:00Z", 40, 200)],
      "year",
      NOW,
    );
    expect([c.currentFrom, c.currentTo, c.previousFrom, c.previousTo]).toEqual(["2026-01-01", "2026-11-18", "2025-01-01", "2025-11-18"]);
    expect(c.previous.km).toBe(12);
  });

  it("si el periodo anterior es más corto (31 mar frente a febrero), se compara entero y se avisa", () => {
    const c = comparePeriodToDate([run("2026-02-27T08:00:00Z", 9, 45)], "month", new Date("2026-03-31T10:00:00Z"));
    expect([c.previousFrom, c.previousTo, c.capped]).toEqual(["2026-02-01", "2026-02-28", true]);
    expect(c.previous.km).toBe(9);
  });

  it("primer día del periodo: se compara solo el primer día", () => {
    const c = comparePeriodToDate([run("2026-11-02T06:00:00Z", 5, 25), run("2026-11-03T06:00:00Z", 9, 45)], "week", new Date("2026-11-09T09:00:00Z"));
    expect([c.currentFrom, c.currentTo, c.previousFrom, c.previousTo]).toEqual(["2026-11-09", "2026-11-09", "2026-11-02", "2026-11-02"]);
    expect(c.previous.km).toBe(5);
    expect(c.current.km).toBe(0);
  });

  it("las carreras de periodos de lesión que se pasen ya filtradas no cuentan", () => {
    const runs = [run("2026-10-05T08:00:00Z", 10, 50, { inInjury: true }), run("2026-10-06T08:00:00Z", 6, 30)];
    const c = comparePeriodToDate(
      runs.filter((r) => !r.inInjury),
      "month",
      NOW,
    );
    expect(c.previous.km).toBe(6);
  });
});

describe("vista Año: ritmo medio por año, alineado con las barras", () => {
  const runs = [
    run("2016-05-10T08:00:00Z", 10, 60), // 6:00
    run("2018-03-01T08:00:00Z", 5, 27.5), // 5:30
    run("2018-09-01T08:00:00Z", 5, 25), // 5:00 → 2018: 52,5 min / 10 km = 5:15
    run("2024-03-01T08:00:00Z", 8, 40), // 5:00
    run("2026-10-17T08:00:00Z", 21, 100), // 4:46
    run("2026-10-20T08:00:00Z", 5, 24, { isSpecial: false }),
    run("2026-02-01T08:00:00Z", 6, 60, { isSpecial: true }), // 10:00 → solo km
    run("2025-06-01T08:00:00Z", 6, 30, { inInjury: true }), // lesión → km sí, ritmo no
  ];
  const years = yearsSinceFirst(runs, NOW);
  const p = buildPeriods(runs, "year", years, NOW);

  it("una columna por año desde el primero hasta el actual (2016–2026), en orden y sin saltos", () => {
    expect(years).toBe(11);
    expect(p.map((x) => x.label)).toEqual(["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
    expect(p.at(-1)!.current).toBe(true);
  });

  it("ritmo medio en cada año con datos, incluido el actual; null en los demás", () => {
    const withPace = p.filter((x) => x.paceSPerKm !== null).map((x) => x.label);
    expect(withPace).toEqual(["2016", "2018", "2024", "2026"]); // 2025: solo lesión → sin ritmo
    expect(p[0].paceSPerKm).toBeCloseTo(360, 5);
    expect(p[2].paceSPerKm).toBeCloseTo(315, 5);
    expect(p[8].paceSPerKm).toBeCloseTo(300, 5);
    expect(p[10].paceSPerKm).toBeCloseTo(((100 + 24) * 60) / 26, 5); // sin la sesión especial
  });

  it("los años sin carreras son huecos (0 km, sin ritmo), no se interpolan", () => {
    for (const label of ["2017", "2019", "2020", "2021", "2022", "2023"]) {
      const x = p.find((y) => y.label === label)!;
      expect([x.km, x.runs, x.paceSPerKm]).toEqual([0, 0, null]);
    }
    expect(p.find((x) => x.label === "2025")).toMatchObject({ km: 6, runs: 1, paceSPerKm: null });
  });

  it("la serie del gráfico de ritmo tiene la misma longitud y orden que las barras", () => {
    expect(p.map((x) => x.paceSPerKm)).toHaveLength(p.length);
    expect(p.map((x) => x.km).filter((k) => k > 0)).toHaveLength(5); // 2016, 2018, 2024, 2025, 2026
  });
});

describe("texto del tramo comparado", () => {
  it("rangos legibles", () => {
    expect(rangeLabel("2026-10-01", "2026-10-18")).toBe("1–18 oct");
    expect(rangeLabel("2026-11-09", "2026-11-09")).toBe("9 nov");
    expect(rangeLabel("2026-10-30", "2026-11-02")).toBe("30 oct – 2 nov");
    expect(rangeLabel("2025-01-01", "2025-11-18", true)).toBe("1 ene – 18 nov 2025");
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
