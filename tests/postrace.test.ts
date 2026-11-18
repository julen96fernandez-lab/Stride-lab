import { describe, expect, it } from "vitest";
import { compareRace } from "@/lib/race/postrace";
import { pacePlan } from "@/lib/race/pacing";

const plan = pacePlan({ distanceM: 10000, targetS: 2700, strategy: "even" }); // 4:30 /km
const real = (deltas: number[]) => deltas.map((d, i) => ({ idx: i + 1, distanceM: 1000, durationS: 270 + d }));

describe("después de la carrera: real frente al plan", () => {
  it("diferencia por km y acumulada (adelantado negativo, atrasado positivo)", () => {
    const r = compareRace(plan, real([-5, -5, 0, 0, 0, 0, 10, 10, 10, 0]), { distanceM: 10000, realTotalS: 2715 });
    expect(r.rows[0]).toMatchObject({ km: 1, planS: 270, realS: 265, diffS: -5, cumDiffS: -5 });
    expect(r.rows[1].cumDiffS).toBe(-10);
    expect(r.rows[8].cumDiffS).toBe(20);
    expect(r.rows[9].cumDiffS).toBe(20);
  });
  it("resumen claro: total, máximo adelantado y atrasado, tramo perdido y ganado, mitades; sin causas", () => {
    const r = compareRace(plan, real([-5, -5, 0, 0, 0, 0, 10, 10, 10, 0]), { distanceM: 10000, realTotalS: 2715 });
    const t = r.summary.join(" ");
    expect(t).toMatch(/Terminaste en 45:15: 0:15 más lento que el objetivo \(45:00\)/);
    expect(t).toMatch(/más adelantado fuiste: km 2, 0:10 por delante/);
    expect(t).toMatch(/más atrasado fuiste: km 9, 0:20 por detrás/);
    expect(t).toMatch(/perdido frente al plan, seguido: los km 7–9 \(\+0:30\)/);
    expect(t).toMatch(/ganado frente al plan, seguido: los km 1–2/);
    expect(t).toMatch(/segunda mitad más lenta/);
    expect(t).not.toMatch(/porque|debido|culpa|calor|cansancio/i);
  });
  it("mitades del plan y reales", () => {
    const r = compareRace(plan, real([0, 0, 0, 0, 0, -6, -6, -6, -6, -6]), { distanceM: 10000, realTotalS: 2670 });
    expect(r.halvesPlan).toEqual([1350, 1350]);
    expect(r.halvesReal).toEqual([1350, 1320]);
    expect(r.summary.join(" ")).toMatch(/segunda mitad más rápida/);
  });
  it("parciales que faltan: lo dice y no inventa", () => {
    const r = compareRace(plan, real([0, 0, 0, 0, 0]), { distanceM: 10000, realTotalS: 2700 });
    expect(r.rows[7]).toMatchObject({ realS: null, diffS: null, cumDiffS: null });
    expect(r.halvesReal).toBeNull();
    expect(r.summary.at(-1)).toMatch(/Faltan parciales/);
  });
  it("último tramo parcial (media: 97,5 m)", () => {
    const half = pacePlan({ distanceM: 21097.5, targetS: 6000, strategy: "even" });
    const act = half.map((p) => ({ idx: p.km, distanceM: p.km === 22 ? 140 : 1000, durationS: p.km === 22 ? 40 : p.splitS }));
    const r = compareRace(half, act, { distanceM: 21097.5, realTotalS: 6000 });
    expect(r.rows[21].realS).toBe(Math.round((40 * 98) / 140)); // el real se escala a la longitud del plan
  });
});
