import { describe, expect, it } from "vitest";
import { bandsInYear, bandsToMs, isInjuryDay, periodInjuryRanges } from "@/lib/analysis/injuries";

const closed = { startDate: "2026-03-10", endDate: "2026-03-24" };
const open = { startDate: "2026-11-10", endDate: null };

describe("bandas de lesión", () => {
  it("día dentro de un periodo cerrado o abierto", () => {
    expect(isInjuryDay("2026-03-10", [closed])).toBe(true);
    expect(isInjuryDay("2026-03-24", [closed])).toBe(true);
    expect(isInjuryDay("2026-03-25", [closed])).toBe(false);
    expect(isInjuryDay("2026-11-17", [open])).toBe(true);
    expect(isInjuryDay("2026-11-09", [open])).toBe(false);
  });

  it("columnas de periodos que se solapan, agrupadas", () => {
    const weeks = ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"];
    expect(periodInjuryRanges(weeks, [closed], "2026-04-01")).toEqual([[1, 3]]);
    const months = ["2026-09-01", "2026-10-01", "2026-11-01"];
    expect(periodInjuryRanges(months, [closed, open], "2026-11-17")).toEqual([[2, 2]]);
    expect(periodInjuryRanges(months, [], "2026-11-17")).toEqual([]);
  });

  it("bandas en el eje de tiempo, recortadas y con el periodo abierto hasta hoy", () => {
    const today = Date.parse("2026-11-17T12:00:00Z");
    const [[a, z]] = bandsToMs([open], Date.parse("2026-01-01T00:00:00Z"), today, today);
    expect(a).toBe(Date.parse("2026-11-10T00:00:00Z"));
    expect(z).toBe(today);
    expect(bandsToMs([closed], Date.parse("2026-06-01T00:00:00Z"), today, today)).toEqual([]);
  });

  it("bandas del año actual en días del año", () => {
    expect(bandsInYear([closed, open], 2026, 320)).toEqual([
      [68, 82],
      [313, 320],
    ]);
    expect(bandsInYear([{ startDate: "2025-12-20", endDate: "2026-01-05" }], 2026, 320)).toEqual([[0, 4]]);
  });
});
