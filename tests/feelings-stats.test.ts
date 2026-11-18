import { describe, expect, it } from "vitest";
import { MIN_RATED, feelingStats, type FeelingRow } from "@/lib/feelings/stats";

const r = (date: string, rating: number | null, tags: FeelingRow["tags"] = []): FeelingRow => ({ date, rating, tags });

describe("sensaciones en Análisis", () => {
  it("media por mes de los últimos 12 meses (los meses sin valoración quedan vacíos)", () => {
    const s = feelingStats([r("2026-11-02", 4), r("2026-11-10", 2), r("2026-09-01", 5), r("2026-11-12", null, ["calor"])], "2026-11-18");
    expect(s.months).toHaveLength(12);
    expect(s.months.at(-1)).toEqual({ month: "2026-11", avg: 3, n: 2 });
    expect(s.months.find((m) => m.month === "2026-10")).toEqual({ month: "2026-10", avg: null, n: 0 });
    expect(s.months[0].month).toBe("2025-12"); // cambio de año
    expect(s.rated).toBe(3);
    expect(s.withAny).toBe(4);
  });
  it(`con menos de ${MIN_RATED} carreras valoradas no saca conclusiones`, () => {
    const rows = Array.from({ length: MIN_RATED - 1 }, (_, i) => r(`2026-10-${String(i + 1).padStart(2, "0")}`, i % 2 ? 1 : 5, ["calor", "piernas_pesadas"]));
    const s = feelingStats(rows, "2026-11-18");
    expect(s.enough).toBe(false);
    expect(s.worst).toEqual([]);
    expect(s.best).toEqual([]);
  });
  it("con datos suficientes: etiquetas que suelen aparecer junto a las peores y a las mejores", () => {
    const rows = [
      r("2026-10-01", 1, ["piernas_pesadas", "sueno_malo"]),
      r("2026-10-03", 2, ["piernas_pesadas", "calor"]),
      r("2026-10-05", 2, ["piernas_pesadas", "sueno_malo"]),
      r("2026-10-07", 3, ["calor"]),
      r("2026-10-09", 4, ["buen_dia"]),
      r("2026-10-11", 5, ["buen_dia", "viento"]),
      r("2026-10-13", 4, ["buen_dia", "piernas_pesadas"]),
      r("2026-10-15", 5, ["viento"]),
    ];
    const s = feelingStats(rows, "2026-11-18");
    expect(s.enough).toBe(true);
    expect(s.worstN).toBe(3);
    expect(s.bestN).toBe(4);
    expect(s.worst[0]).toEqual({ tag: "piernas_pesadas", count: 3, of: 3, otherCount: 1, otherOf: 4 });
    expect(s.worst.map((l) => l.tag)).toEqual(["piernas_pesadas", "sueno_malo"]); // «calor» solo 1 vez en las peores
    expect(s.best.map((l) => l.tag)).toEqual(["buen_dia", "viento"]);
  });
  it("una etiqueta que aparece una sola vez no se menciona", () => {
    const rows = Array.from({ length: 8 }, (_, i) => r(`2026-10-${String(i + 1).padStart(2, "0")}`, i < 4 ? 1 : 5, i === 0 ? ["estomago"] : []));
    const s = feelingStats(rows, "2026-11-18");
    expect(s.worst).toEqual([]);
  });
});
