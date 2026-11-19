import { describe, expect, it } from "vitest";
import { linkMine, mineMatches, mineStatus, unplannedRuns } from "@/lib/plan/linking";
import { weekOf } from "@/lib/plan/mine";

const run = (id: string, date: string, type: string | null, h = 8) => ({ id, date, type, at: Date.parse(`${date}T0${h}:00:00Z`) });
const ids = (m: Map<string, { id: string }>) => Object.fromEntries([...m].map(([k, v]) => [k, v.id]));

describe("vinculación de mis sesiones (mismo día o ±1)", () => {
  it("mismo día", () => {
    expect(ids(linkMine([{ id: "a", date: "2026-11-21", kind: "tirada_larga" }], [run("r1", "2026-11-21", "tirada_larga")]))).toEqual({ a: "r1" });
  });
  it("±1 día, y no más", () => {
    const mine = [{ id: "a", date: "2026-11-21", kind: "suave" }];
    expect(ids(linkMine(mine, [run("r1", "2026-11-22", "rodaje")]))).toEqual({ a: "r1" });
    expect(ids(linkMine(mine, [run("r1", "2026-11-20", "rodaje")]))).toEqual({ a: "r1" });
    expect(ids(linkMine(mine, [run("r1", "2026-11-23", "rodaje")]))).toEqual({});
  });
  it("primero se reparten las del mismo día: la carrera del martes es del martes, no del lunes", () => {
    const mine = [
      { id: "lun", date: "2026-11-16", kind: "suave" },
      { id: "mar", date: "2026-11-17", kind: "calidad" },
    ];
    expect(ids(linkMine(mine, [run("r1", "2026-11-17", "series")]))).toEqual({ mar: "r1" });
    expect(ids(linkMine(mine, [run("r1", "2026-11-17", "series"), run("r0", "2026-11-15", "rodaje")]))).toEqual({ mar: "r1", lun: "r0" });
  });
  it("una carrera solo vale para una sesión; a igualdad, la del tipo previsto", () => {
    const mine = [{ id: "a", date: "2026-11-21", kind: "tirada_larga" }];
    expect(ids(linkMine(mine, [run("r1", "2026-11-21", "rodaje", 7), run("r2", "2026-11-21", "tirada_larga", 9)]))).toEqual({ a: "r2" });
    const two = [...mine, { id: "b", date: "2026-11-21", kind: "suave" }];
    expect(ids(linkMine(two, [run("r1", "2026-11-21", "tirada_larga")]))).toEqual({ a: "r1" });
  });
});

describe("estado de mi sesión", () => {
  it("cumplida, otro tipo, pendiente y no hecha", () => {
    expect(mineStatus({ date: "2026-11-21", kind: "calidad" }, run("r", "2026-11-21", "tempo"), "2026-11-22")).toBe("cumplida");
    expect(mineStatus({ date: "2026-11-21", kind: "calidad" }, run("r", "2026-11-21", "rodaje"), "2026-11-22")).toBe("otra");
    expect(mineStatus({ date: "2026-11-21", kind: "otro" }, run("r", "2026-11-21", "trail"), "2026-11-22")).toBe("cumplida");
    // sin carrera: pendiente hasta el día siguiente incluido (margen de ±1)
    expect(mineStatus({ date: "2026-11-21", kind: "suave" }, null, "2026-11-22")).toBe("pendiente");
    expect(mineStatus({ date: "2026-11-21", kind: "suave" }, null, "2026-11-23")).toBe("no_hecha");
  });
  it("tipos que valen", () => {
    expect(mineMatches("tirada_larga", "tirada_larga")).toBe(true);
    expect(mineMatches("tirada_larga", "rodaje")).toBe(false);
    expect(mineMatches("calidad", "competicion")).toBe(true);
    expect(mineMatches("suave", null)).toBe(true);
  });
});

describe("sesión no prevista", () => {
  const sug = new Map([["2026-11-16", "tirada_larga" as const]]);
  it("la que cumple la sugerencia de su semana no es «no prevista»; las demás sí", () => {
    const rs = [run("a", "2026-11-17", "rodaje"), run("b", "2026-11-21", "tirada_larga"), run("c", "2026-11-25", "series")];
    expect(unplannedRuns(rs, new Set(), sug, weekOf).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("si ninguna es del tipo sugerido, la primera de la semana cubre la sugerencia", () => {
    const rs = [run("a", "2026-11-17", "rodaje"), run("b", "2026-11-19", "series")];
    expect(unplannedRuns(rs, new Set(), sug, weekOf).map((r) => r.id)).toEqual(["b"]);
  });
  it("las vinculadas a mis sesiones no son «no previstas»; sin sugerencia, el resto sí", () => {
    const rs = [run("a", "2026-11-24", "rodaje"), run("b", "2026-11-26", "series")];
    expect(unplannedRuns(rs, new Set(["a"]), sug, weekOf).map((r) => r.id)).toEqual(["b"]);
  });
});
