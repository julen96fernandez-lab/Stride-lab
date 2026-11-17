import { describe, expect, it } from "vitest";
import { durabilityFromSeries, durabilityFromSplits } from "@/lib/analysis/durability";
import { paceAtHrByYear, parseBand } from "@/lib/analysis/pace-at-hr";

describe("durabilidad", () => {
  it("ritmo igual y FC que sube → desacople positivo", () => {
    // 10 km en 3000 s a ritmo constante (intervalos de 60 s = 200 m)
    const t = Array.from({ length: 50 }, (_, i) => (i + 1) * 60);
    const v = t.map(() => 200);
    const hr = { t: Array.from({ length: 101 }, (_, i) => i * 30), v: Array.from({ length: 101 }, (_, i) => (i * 30 < 1500 ? 150 : 160)) };
    const d = durabilityFromSeries({ t, v }, hr)!;
    expect(d.first.paceSPerKm).toBeCloseTo(300, 5);
    expect(d.second.paceSPerKm).toBeCloseTo(300, 5);
    expect(d.paceDeltaS).toBeCloseTo(0, 5);
    expect(d.first.avgHr).toBeCloseTo(150, 0);
    expect(d.second.avgHr).toBeCloseTo(160, 0);
    expect(d.decouplingPct!).toBeCloseTo((1 - 150 / 160) * 100, 0);
  });

  it("sin FC no inventa el desacople", () => {
    const d = durabilityFromSplits([
      { distanceM: 1000, durationS: 300 },
      { distanceM: 1000, durationS: 330 },
    ])!;
    expect(d.first.paceSPerKm).toBe(300);
    expect(d.second.paceSPerKm).toBe(330);
    expect(d.first.avgHr).toBeNull();
    expect(d.decouplingPct).toBeNull();
  });

  it("carreras muy cortas: sin resultado", () => {
    expect(durabilityFromSplits([{ distanceM: 600, durationS: 200 }])).toBeNull();
  });
});

describe("ritmo a igual FC por año", () => {
  const r = (year: number, km: number, min: number, hr: number | null, isSpecial = false) => ({
    year,
    distanceM: km * 1000,
    durationS: min * 60,
    avgHr: hr,
    isSpecial,
  });

  it("filtra franja, ≥ 5 km, no especiales, y deja años vacíos", () => {
    const out = paceAtHrByYear(
      [
        r(2024, 10, 55, 145),
        r(2024, 10, 50, 148),
        r(2024, 4, 20, 145), // < 5 km
        r(2024, 10, 50, 155), // fuera de franja
        r(2024, 10, 90, 145, true), // especial
        r(2026, 8, 40, 141),
        r(2026, 8, 40, null), // sin FC
      ],
      [140, 150],
      2022,
      2026,
    );
    expect(out.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(out[0]).toMatchObject({ runs: 0, paceSPerKm: null });
    expect(out[2].runs).toBe(2);
    expect(out[2].paceSPerKm).toBeCloseTo(315, 5); // 105 min / 20 km
    expect(out[4]).toMatchObject({ runs: 1, paceSPerKm: 300 });
  });

  it("franja ajustable con límites", () => {
    expect(parseBand("135-145")).toEqual([135, 145]);
    expect(parseBand("10-300")).toEqual([140, 150]);
    expect(parseBand(undefined)).toEqual([140, 150]);
  });
});
