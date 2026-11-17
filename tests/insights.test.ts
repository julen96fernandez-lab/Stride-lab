import { describe, expect, it } from "vitest";
import {
  calendarDays,
  cumulativeByDay,
  intensityLevels,
  movingAverage,
  pacePoints,
  smoothTrend,
  yearToDate,
  type RunForPace,
} from "@/lib/analysis/insights";
import { buildPeriods } from "@/lib/analysis/periods";

const NOW = new Date("2026-11-18T11:00:00Z"); // miércoles

describe("km por tipo en cada periodo", () => {
  it("agrupa km por tipo, incluidas especiales y sin tipo", () => {
    const base = { durationS: 1800, avgHr: null, elevationGainM: null, trainingLoad: null, hrZoneSeconds: null };
    const [w] = buildPeriods(
      [
        { ...base, startAt: new Date("2026-11-16T08:00:00Z"), distanceM: 8000, isSpecial: false, type: "rodaje" },
        { ...base, startAt: new Date("2026-11-17T08:00:00Z"), distanceM: 6000, isSpecial: true, type: "series" },
        { ...base, startAt: new Date("2026-11-17T18:00:00Z"), distanceM: 2000, isSpecial: false, type: "rodaje" },
        { ...base, startAt: new Date("2026-11-18T08:00:00Z"), distanceM: 1000, isSpecial: false, type: null },
      ],
      "week",
      1,
      NOW,
    );
    expect(w.km).toBe(17);
    expect(w.kmByType).toEqual({ rodaje: 10, series: 6, sin_tipo: 1 });
  });
});

describe("media móvil de 4 semanas", () => {
  it("solo con la ventana completa", () => {
    expect(movingAverage([10, 20, 30, 40, 50, 0], 4)).toEqual([null, null, null, 25, 35, 30]);
  });
});

describe("evolución del ritmo", () => {
  const r = (id: string, iso: string, pace: number, o: Partial<RunForPace> = {}): RunForPace => ({
    id,
    startAt: new Date(iso),
    distanceM: 8000,
    durationS: pace * 8,
    avgPaceSPerKm: pace,
    avgHr: 145,
    isSpecial: false,
    type: "rodaje",
    ...o,
  });
  const runs = [
    r("a", "2026-05-01T08:00:00Z", 330),
    r("b", "2026-10-01T08:00:00Z", 320, { type: "tempo" }),
    r("c", "2026-10-20T08:00:00Z", 540, { isSpecial: true }),
    r("d", "2026-11-01T08:00:00Z", 310),
    r("e", "2026-11-10T08:00:00Z", 300),
  ];
  it("filtra por rango y tipo y excluye especiales", () => {
    expect(pacePoints(runs, "1m", null, NOW).map((p) => p.id)).toEqual(["d", "e"]);
    expect(pacePoints(runs, "3m", null, NOW).map((p) => p.id)).toEqual(["b", "d", "e"]);
    expect(pacePoints(runs, "all", "rodaje", NOW).map((p) => p.id)).toEqual(["a", "d", "e"]);
  });
  it("tendencia suavizada entre el mínimo y el máximo, sin inventar con < 3 puntos", () => {
    const pts = pacePoints(runs, "all", null, NOW);
    const tr = smoothTrend(pts);
    expect(tr).toHaveLength(pts.length);
    tr.forEach((x) => {
      expect(x.pace).toBeGreaterThanOrEqual(300);
      expect(x.pace).toBeLessThanOrEqual(330);
    });
    expect(tr[tr.length - 1].pace).toBeLessThan(tr[0].pace); // va mejorando
    expect(smoothTrend(pts.slice(0, 2))).toEqual([]);
  });
});

describe("calendario de constancia", () => {
  const day = (id: string, iso: string, km: number, load: number | null = null) => ({
    id,
    startAt: new Date(iso),
    distanceM: km * 1000,
    durationS: km * 300,
    trainingLoad: load,
    type: "rodaje",
  });
  it("una casilla por día desde un lunes; suma el día; días sin correr vacíos", () => {
    const cal = calendarDays([day("a", "2026-11-17T07:00:00Z", 5, 60), day("b", "2026-11-17T18:00:00Z", 3, 40)], NOW);
    expect(cal[0].weekday).toBe(0);
    expect(cal.at(-1)!.date).toBe("2026-11-18");
    const tue = cal.find((c) => c.date === "2026-11-17")!;
    expect(tue).toMatchObject({ km: 8, load: 100 });
    expect(tue.runs).toHaveLength(2);
    expect(cal.find((c) => c.date === "2026-11-16")).toMatchObject({ km: 0, load: null, runs: [] });
    expect(cal.length).toBeGreaterThanOrEqual(365);
  });
  it("niveles por cuartiles; 0 = sin correr", () => {
    expect(intensityLevels([0, null, 1, 2, 3, 4, 10])).toEqual([0, 0, 1, 1, 2, 3, 4]); // cortes en 2, 3 y 4
  });
});

describe("comparación de años", () => {
  const y = (iso: string, km: number, o: Partial<{ isSpecial: boolean; elevationGainM: number | null }> = {}) => ({
    startAt: new Date(iso),
    distanceM: km * 1000,
    durationS: km * 330,
    elevationGainM: o.elevationGainM ?? null,
    isSpecial: o.isSpecial ?? false,
  });
  const runs = [
    y("2025-01-05T08:00:00Z", 10, { elevationGainM: 50 }),
    y("2025-11-17T08:00:00Z", 8), // mismo día del año que hoy (18-nov → incluye el 17)
    y("2025-11-30T08:00:00Z", 12), // después: no cuenta en «hasta la misma fecha»
    y("2026-02-01T08:00:00Z", 6, { isSpecial: true }),
    y("2026-11-17T08:00:00Z", 9),
  ];
  it("acumulado por día del año", () => {
    const cum = cumulativeByDay(runs, 2025);
    expect(cum).toHaveLength(365);
    expect(cum[3]).toBe(0);
    expect(cum[4]).toBe(10);
    expect(cum[364]).toBe(30);
  });
  it("hasta la misma fecha que el año pasado", () => {
    const r = yearToDate(runs, NOW);
    expect(r.year).toBe(2026);
    expect(r.current).toMatchObject({ km: 15, runs: 2 });
    expect(r.current.paceSPerKm).toBeCloseTo(330, 5); // la especial no cuenta en el ritmo
    expect(r.previous).toMatchObject({ km: 18, runs: 2, elevationGainM: 50 });
    expect(r.currentCum).toHaveLength(r.doy + 1);
    expect(r.previousCum.at(-1)).toBe(30);
  });
});
