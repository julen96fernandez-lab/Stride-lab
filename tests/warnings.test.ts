import { describe, expect, it } from "vitest";
import { mineWarnings, type WarnCtx } from "@/lib/plan/warnings";

const A = "2026-11-23"; // lunes, tardes; noches 30 nov–6 dic; libre 7–13; mañanas 14–20
const ctx = (o: Partial<WarnCtx> = {}): WarnCtx => ({ anchor: A, races: [], exigentes: [], ...o });

describe("avisos de mis sesiones: turnos", () => {
  it("tras una noche, nada exigente", () => {
    expect(mineWarnings({ date: "2026-12-07", kind: "calidad" }, ctx())).toEqual(["Tras una noche: nada exigente ese día (regla de turnos)."]);
    expect(mineWarnings({ date: "2026-12-07", kind: "suave" }, ctx())).toEqual([]);
  });
  it("semana de noches: solo suave u opcional", () => {
    expect(mineWarnings({ date: "2026-12-05", kind: "tirada_larga" }, ctx())[0]).toMatch(/Semana de noches/);
    expect(mineWarnings({ date: "2026-12-05", kind: "otro" }, ctx())).toEqual([]);
  });
  it("sin ciclo de turnos, sin avisos de turnos", () => {
    expect(mineWarnings({ date: "2026-12-05", kind: "tirada_larga" }, ctx({ anchor: null }))).toEqual([]);
  });
});

describe("avisos de mis sesiones: exigentes", () => {
  const ex = ctx({ exigentes: [{ date: "2026-12-12", kind: "long", what: "tu tirada larga", id: "x" }, { date: "2026-12-09", kind: "quality", what: "la calidad sugerida" }] });
  it("dos exigentes en días seguidos", () => {
    expect(mineWarnings({ date: "2026-12-13", kind: "calidad" }, ex)).toEqual(["Dos exigentes en días seguidos: tu tirada larga del sábado 12."]);
    expect(mineWarnings({ date: "2026-12-11", kind: "suave" }, ex)).toEqual([]);
  });
  it("el mismo tipo exigente dos veces seguidas", () => {
    expect(mineWarnings({ date: "2026-12-16", kind: "tirada_larga" }, ex)).toEqual(["Repite tirada larga: la exigente anterior es tu tirada larga del sábado 12; toca alternar."]);
    expect(mineWarnings({ date: "2026-12-16", kind: "calidad" }, ex)).toEqual([]);
    // el 11 además está junto a la tirada larga del 12: salen los dos avisos
    const w = mineWarnings({ date: "2026-12-11", kind: "calidad" }, ex);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/días seguidos/);
    expect(w[1]).toMatch(/Repite calidad: la exigente anterior es la calidad sugerida del miércoles 9/);
  });
  it("no se compara consigo misma (al editarla)", () => {
    expect(mineWarnings({ id: "x", date: "2026-12-12", kind: "tirada_larga" }, ex)).toEqual([]);
  });
});

describe("avisos de mis sesiones: afinado", () => {
  const r = ctx({ anchor: null, races: [{ name: "Media", date: "2026-12-20" }] });
  it("semana de la carrera: solo suave corto y no en los 2 días previos; el mismo día es la carrera", () => {
    expect(mineWarnings({ date: "2026-12-16", kind: "calidad" }, r)).toEqual(["Semana de la carrera (Media): solo un rodaje suave corto."]);
    expect(mineWarnings({ date: "2026-12-17", kind: "suave" }, r)).toEqual([]);
    expect(mineWarnings({ date: "2026-12-19", kind: "suave" }, r)[0]).toMatch(/A menos de 2 días/);
    expect(mineWarnings({ date: "2026-12-20", kind: "otro" }, r)).toEqual(["Es el día de la carrera (Media)."]);
  });
  it("la semana anterior, solo suave; dos semanas antes, nada de tirada larga", () => {
    expect(mineWarnings({ date: "2026-12-10", kind: "calidad" }, r)[0]).toMatch(/Semana anterior a la carrera/);
    expect(mineWarnings({ date: "2026-12-10", kind: "suave" }, r)).toEqual([]);
    expect(mineWarnings({ date: "2026-12-05", kind: "tirada_larga" }, r)[0]).toMatch(/Dos semanas antes/);
    expect(mineWarnings({ date: "2026-12-05", kind: "calidad" }, r)).toEqual([]);
  });
  it("una carrera ya pasada no cuenta", () => {
    expect(mineWarnings({ date: "2026-12-22", kind: "tirada_larga" }, r)).toEqual([]);
  });
});
