import { describe, expect, it } from "vitest";
import { INTENSITY_RULES, coversEnough, intensity, type IntensityRun } from "@/lib/analysis/intensity";

const D = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
const TODAY = D("2026-11-26");
// 50 min: 40 suave (Z1–Z2), 5 medio (Z3), 5 fuerte (Z4–Z5); cubre el 100 %
const run = (ymd: string, z: number[] | null = [600, 1800, 300, 200, 100], durationS = 3000): IntensityRun => ({ day: D(ymd), durationS, zoneSeconds: z });

describe("intensidad: qué carreras cuentan", () => {
  it("solo las que tienen pulso en al menos el 80 % de la duración", () => {
    expect(coversEnough({ durationS: 3000, zoneSeconds: [0, 2400, 0, 0, 0] })).toBe(true);
    expect(coversEnough({ durationS: 3000, zoneSeconds: [0, 2300, 0, 0, 0] })).toBe(false);
    expect(coversEnough({ durationS: 3000, zoneSeconds: null })).toBe(false);
  });
  it("cuenta las que entran y las que se dejan fuera por pulso insuficiente (solo del periodo)", () => {
    const r = intensity([run("2026-11-24"), run("2026-11-20", [0, 1000, 0, 0, 0]), run("2026-11-18", null), run("2025-01-01")], "12s", TODAY);
    expect(r).toMatchObject({ valid: 1, excluded: 2 });
  });
});

describe("intensidad: reparto", () => {
  it("por tiempo: suave = Z1+Z2, medio = Z3, fuerte = Z4+Z5; % del total", () => {
    const r = intensity([run("2026-11-24"), run("2026-11-17", [0, 600, 600, 600, 0], 1800)], "12s", TODAY);
    expect([r.easyS, r.midS, r.hardS]).toEqual([3000, 900, 900]);
    expect(r.pct!.easy).toBeCloseTo(3000 / 4800);
  });
  it("12 semanas: 12 cubos de lunes, el último el de esta semana", () => {
    const r = intensity([], "12s", TODAY);
    expect(r.buckets).toHaveLength(INTENSITY_RULES.weeks);
    expect(r.buckets.at(-1)!.key).toBe("2026-11-23");
    expect(r.buckets[0].key).toBe("2026-09-07");
  });
  it("12 meses: de diciembre a noviembre (cruza el año); todo: desde el primer mes con pulso", () => {
    const m = intensity([], "12m", TODAY);
    expect(m.buckets.map((b) => b.key)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    const t = intensity([run("2026-09-14"), run("2018-03-01", null)], "todo", TODAY);
    expect(t.buckets.map((b) => b.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(t.excluded).toBe(0); // la de 2018 queda antes del primer mes con pulso
    expect(intensity([], "todo", TODAY).buckets.map((b) => b.key)).toEqual(["2026-11"]);
  });
  it("con menos de 5 carreras válidas no hay conclusión; con 5, la frase neutra", () => {
    const four = ["2026-11-24", "2026-11-17", "2026-11-10", "2026-11-03"].map((d) => run(d));
    expect(intensity(four, "12s", TODAY).sentence).toBeNull();
    const five = intensity([...four, run("2026-10-27")], "12s", TODAY);
    expect(five.sentence).toBe("Tu reparto: 80 % suave, 10 % medio y 10 % fuerte (en 5 carreras con pulso suficiente).");
    expect(five.sentence).not.toMatch(/deberías|demasiado|poco|mal|bien/i);
  });
  it("las carreras futuras no cuentan", () => {
    expect(intensity([run("2026-11-28")], "12s", TODAY).valid).toBe(0);
  });
});
