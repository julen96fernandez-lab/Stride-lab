import { describe, expect, it } from "vitest";
import { timeTicks } from "@/lib/analysis/time-ticks";

const U = (s: string) => Date.parse(`${s}T00:00:00Z`);
const gaps = (v: number[]) => v.slice(1).map((x, i) => x - v[i]);

describe("marcas del eje de tiempo", () => {
  it("diez años: marcas cada pocos años, el 1 de enero, sin repetir", () => {
    const t = timeTicks(U("2016-05-10"), U("2026-11-17"));
    const labels = t.values.map(t.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(t.values.every((v) => new Date(v).getUTCMonth() === 0 && new Date(v).getUTCDate() === 1)).toBe(true);
    expect(t.values.length).toBeLessThanOrEqual(5);
    expect(labels).toEqual(["2019", "2022", "2025"]);
    expect(new Set(gaps(t.values.map((v) => new Date(v).getUTCFullYear()))).size).toBe(1);
  });

  it("dos años y medio: cada año exacto", () => {
    const t = timeTicks(U("2024-03-01"), U("2026-11-17"));
    expect(t.values.map(t.label)).toEqual(["2025", "2026"]);
    const months = t.values.map((v) => new Date(v).getUTCFullYear() * 12 + new Date(v).getUTCMonth());
    expect(new Set(gaps(months)).size).toBe(1); // paso regular
  });

  it("un año: trimestres en español con año si cruza de año", () => {
    const t = timeTicks(U("2025-11-17"), U("2026-11-17"));
    expect(t.values.map(t.label)).toEqual(["ene '26", "abr '26", "jul '26", "oct '26"]);
  });

  it("un mes: cada semana, «d mes»", () => {
    const t = timeTicks(U("2026-10-17"), U("2026-11-17"));
    expect(t.values.map(t.label)).toEqual(["17 oct", "24 oct", "31 oct", "7 nov", "14 nov"]);
  });
});
