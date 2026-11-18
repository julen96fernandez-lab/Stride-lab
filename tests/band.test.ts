import { describe, expect, it } from "vitest";
import { BAND_H, bandLayout } from "@/lib/race/band";

describe("banda de ritmos (imagen vertical)", () => {
  it("5K y 10K: una columna con letra grande", () => {
    for (const n of [5, 10]) {
      const l = bandLayout(n);
      expect(l.columns).toBe(1);
      expect(l.fontPx).toBeGreaterThanOrEqual(60);
    }
  });
  it("media (22 filas): cabe en una columna, legible", () => {
    const l = bandLayout(22);
    expect(l.columns).toBe(1);
    expect(l.tableTop + l.rowH * 22).toBeLessThanOrEqual(l.bottom);
    expect(l.fontPx).toBeGreaterThanOrEqual(40);
  });
  it("maratón (43 filas): dos columnas, sin salirse y legible", () => {
    const l = bandLayout(43);
    expect(l.columns).toBe(2);
    expect(l.rowsPerColumn).toBe(22);
    expect(l.tableTop + l.rowH * l.rowsPerColumn).toBeLessThanOrEqual(l.bottom);
    expect(l.fontPx).toBeGreaterThanOrEqual(36);
  });
  it("deja libre la zona del reloj (arriba) y la de los accesos (abajo)", () => {
    const l = bandLayout(22);
    expect(l.top).toBeGreaterThanOrEqual(BAND_H * 0.27 - 1);
    expect(l.bottom).toBeLessThanOrEqual(BAND_H * 0.9 + 1);
  });
});
