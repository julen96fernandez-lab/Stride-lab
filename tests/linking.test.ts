import { describe, expect, it } from "vitest";
import { assignRuns, doneWhen, linkMine, mineMatches, mineStatus, runDayLabel, unplannedRuns } from "@/lib/plan/linking";
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

describe("descanso", () => {
  it("no se vincula con ninguna carrera y su estado es «Descanso»", () => {
    const mine = [{ id: "d", date: "2026-11-21", kind: "descanso" }, { id: "s", date: "2026-11-22", kind: "suave" }];
    expect(ids(linkMine(mine, [run("r1", "2026-11-21", "rodaje")]))).toEqual({ s: "r1" });
    expect(mineStatus({ date: "2026-11-21", kind: "descanso" }, null, "2026-11-30")).toBe("descanso");
  });
});

describe("vinculación por semana (26‑nov‑2026)", () => {
  const link = (slots: Parameters<typeof assignRuns>[0], runs: ReturnType<typeof run>[]) =>
    Object.fromEntries([...assignRuns(slots, runs)].map(([k, v]) => [k, [v.run.id, v.offset, v.manual]]));
  // Semana del lunes 23 al domingo 29 de noviembre de 2026.
  it("carrera antes de su día: la tirada larga del sábado, corrida el jueves, queda cumplida", () => {
    const slots = [{ id: "sab", date: "2026-11-28", kind: "tirada_larga" }];
    expect(link(slots, [run("r", "2026-11-26", "tirada_larga")])).toEqual({ sab: ["r", -2, false] });
    expect(mineStatus(slots[0], run("r", "2026-11-26", "tirada_larga"), "2026-11-26")).toBe("cumplida");
    // y después de su día, en la misma semana
    const lun = [{ id: "lun", date: "2026-11-23", kind: "calidad" }];
    expect(link(lun, [run("r", "2026-11-26", "series")])).toEqual({ lun: ["r", 3, false] });
  });
  it("carrera de otro tipo: fuera de ±1 día no cubre una exigente; dentro, «Hecha, otro tipo»", () => {
    const sab = [{ id: "sab", date: "2026-11-28", kind: "calidad" }];
    expect(link(sab, [run("r", "2026-11-25", "rodaje")])).toEqual({});
    expect(link(sab, [run("r", "2026-11-27", "rodaje")])).toEqual({ sab: ["r", -1, false] });
    expect(mineStatus(sab[0], run("r", "2026-11-27", "rodaje"), "2026-11-28")).toBe("otra");
    // una suave se cubre con cualquier carrera de la semana
    expect(link([{ id: "s", date: "2026-11-28", kind: "suave" }], [run("r", "2026-11-24", "series")])).toEqual({ s: ["r", -4, false] });
  });
  it("dos sesiones y una sola carrera: cubre la del tipo de la carrera, aunque la otra esté más cerca", () => {
    const slots = [
      { id: "mie", date: "2026-11-25", kind: "suave" },
      { id: "sug:2026-11-23", date: "2026-11-28", kind: "tirada_larga" },
    ];
    expect(link(slots, [run("r", "2026-11-26", "tirada_larga")])).toEqual({ "sug:2026-11-23": ["r", -2, false] });
    // con dos carreras, cada una la suya; una carrera nunca cubre dos sesiones
    expect(link(slots, [run("r", "2026-11-26", "tirada_larga"), run("q", "2026-11-25", "rodaje")])).toEqual({
      "sug:2026-11-23": ["r", -2, false],
      mie: ["q", 0, false],
    });
    // sin carrera del tipo: la suave se queda con la que hay; la exigente, nada
    expect(link(slots, [run("q", "2026-11-26", "rodaje")])).toEqual({ mie: ["q", 1, false] });
  });
  it("cambio de semana: el resto de la semana no cruza el domingo (solo el margen de ±1 día, como antes)", () => {
    const sab = [{ id: "sab", date: "2026-11-28", kind: "tirada_larga" }];
    expect(link(sab, [run("r", "2026-11-30", "tirada_larga")])).toEqual({});
    expect(link(sab, [run("r", "2026-11-21", "tirada_larga")])).toEqual({});
    const dom = [{ id: "dom", date: "2026-11-29", kind: "tirada_larga" }];
    expect(link(dom, [run("r", "2026-11-30", "tirada_larga")])).toEqual({ dom: ["r", 1, false] });
    // cambio de año dentro de la semana (lunes 28‑dic‑2026 a domingo 3‑ene‑2027)
    expect(link([{ id: "a", date: "2027-01-02", kind: "calidad" }], [run("r", "2026-12-29", "tempo")])).toEqual({ a: ["r", -4, false] });
  });
  it("pendiente hasta el domingo de su semana (o el lunes siguiente si es domingo)", () => {
    const lun = { date: "2026-11-23", kind: "tirada_larga" };
    expect(mineStatus(lun, null, "2026-11-29")).toBe("pendiente");
    expect(mineStatus(lun, null, "2026-11-30")).toBe("no_hecha");
    expect(mineStatus({ date: "2026-11-29", kind: "suave" }, null, "2026-11-30")).toBe("pendiente");
  });
  it("vínculo manual: manda sobre el cálculo; «Desvincular» deja la sesión sin carrera", () => {
    const runs = [run("r1", "2026-11-28", "tirada_larga"), run("r2", "2026-11-24", "rodaje")];
    const slots = [
      { id: "sab", date: "2026-11-28", kind: "tirada_larga", manual: "r2" },
      { id: "mie", date: "2026-11-25", kind: "suave" },
    ];
    expect(link(slots, runs)).toEqual({ sab: ["r2", -4, true], mie: ["r1", 3, false] });
    expect(link([{ ...slots[0], manual: null }, slots[1]], runs)).toEqual({ mie: ["r2", -1, false] });
  });
});

describe("«Hecha antes / después»", () => {
  it("dice el día de la carrera; el mismo día, nada", () => {
    expect(doneWhen({ offset: -2, run: { date: "2026-11-26" } })).toBe("Hecha antes (jueves 26)");
    expect(doneWhen({ offset: 1, run: { date: "2026-11-23" } })).toBe("Hecha después (lunes 23)");
    expect(doneWhen({ offset: 0, run: { date: "2026-11-26" } })).toBeNull();
    expect(doneWhen(null)).toBeNull();
    expect(runDayLabel("2027-01-03")).toBe("domingo 3");
  });
});
