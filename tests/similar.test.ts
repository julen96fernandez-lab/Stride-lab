import { describe, expect, it } from "vitest";
import { compareSimilar, type SimilarPoint } from "@/lib/analysis/similar";

const d = (n: number) => new Date(Date.UTC(2026, 9, n, 8));
const p = (id: string, day: number, o: Partial<SimilarPoint> = {}): SimilarPoint => ({ id, startAt: d(day), paceS: 300, avgHr: 150, load: 60, current: false, ...o });
const cur = p("cur", 30, { paceS: 290, avgHr: 152, load: 70, current: true });

describe("sesiones parecidas", () => {
  it("con menos de 3 parecidas no compara", () => {
    expect(compareSimilar(cur, [p("a", 1), p("b", 2)])).toBeNull();
  });
  it("ritmo, pulso y carga: barras por fecha, media sin la actual y posición", () => {
    const sims = [p("a", 1, { paceS: 310, avgHr: 148, load: 50 }), p("b", 5, { paceS: 285, avgHr: 155, load: 80 }), p("c", 9, { paceS: 300, avgHr: 150, load: 60 })];
    const r = compareSimilar(cur, sims)!;
    expect(r.map((m) => m.key)).toEqual(["pace", "hr", "load"]);
    const pace = r[0];
    expect(pace.bars.map((b) => b.id)).toEqual(["a", "b", "c", "cur"]);
    expect(pace.bars.at(-1)!.current).toBe(true);
    expect(pace.mean).toBeCloseTo((310 + 285 + 300) / 3);
    expect(pace).toMatchObject({ rank: 2, of: 4, position: "La 2.ª más rápida de 4" });
    expect(r[1]).toMatchObject({ rank: 3, position: "El 3.º pulso medio más bajo de 4" });
    expect(r[2]).toMatchObject({ rank: 3, position: "La 3.ª carga más baja de 4" });
  });
  it("extremos y empates (la actual no se penaliza)", () => {
    const sims = [p("a", 1, { paceS: 300 }), p("b", 2, { paceS: 300 }), p("c", 3, { paceS: 300 })];
    expect(compareSimilar({ ...cur, paceS: 300 }, sims)![0].position).toBe("La más rápida de 4");
    expect(compareSimilar({ ...cur, paceS: 320 }, sims)![0].position).toBe("La más lenta de 4");
    expect(compareSimilar({ ...cur, load: 10 }, sims)!.find((m) => m.key === "load")!.position).toBe("La carga más baja de 4");
  });
  it("cada métrica solo si la actual la tiene y al menos 3 parecidas también (pulso: solo fiable, ya filtrado)", () => {
    const sims = [p("a", 1, { avgHr: null }), p("b", 2), p("c", 3), p("e", 4, { load: null })];
    const r = compareSimilar(cur, sims)!;
    expect(r.find((m) => m.key === "hr")!.of).toBe(4); // 3 con pulso + la actual
    expect(compareSimilar({ ...cur, avgHr: null }, sims)!.some((m) => m.key === "hr")).toBe(false);
    const fewHr = [p("a", 1, { avgHr: null }), p("b", 2, { avgHr: null }), p("c", 3)];
    expect(compareSimilar(cur, fewHr)!.some((m) => m.key === "hr")).toBe(false);
  });
});
