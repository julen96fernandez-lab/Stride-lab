import { describe, expect, it } from "vitest";
import { addMonths, blockRange, buildCalendar, calKindOfSuggestion, covers, mergeBlocks, monthGrid } from "@/lib/plan/calendar";
import { shiftWeek } from "@/lib/plan/shifts";

describe("cuadrícula del mes (lunes a domingo)", () => {
  const days = (y: number, m: number) => monthGrid(y, m).flatMap((w) => w.days).filter((d) => d.inMonth).length;
  it("meses de 28, 29, 30 y 31 días", () => {
    expect(days(2026, 2)).toBe(28);
    expect(days(2028, 2)).toBe(29);
    expect(days(2026, 11)).toBe(30);
    expect(days(2026, 12)).toBe(31);
  });
  it("empieza en lunes y acaba en domingo, con días de los meses vecinos", () => {
    const g = monthGrid(2026, 11); // 1-nov-2026 es domingo
    expect(g[0].start).toBe("2026-10-26");
    expect(g[0].days[6]).toEqual({ ymd: "2026-11-01", d: 1, inMonth: true });
    expect(g[0].days[0].inMonth).toBe(false);
    expect(g.at(-1)!.days[6].ymd).toBe("2026-12-06");
    expect(g).toHaveLength(6);
  });
  it("febrero de 2027 empieza en lunes y cabe en 4 semanas", () => {
    const g = monthGrid(2027, 2);
    expect(g).toHaveLength(4);
    expect(g[0].start).toBe("2027-02-01");
  });
  it("semana que cruza de año", () => {
    const g = monthGrid(2027, 1); // 1-ene-2027 es viernes
    expect(g[0].start).toBe("2026-12-28");
    expect(g[0].days.map((d) => d.ymd)).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(monthGrid(2026, 12).at(-1)!.start).toBe("2026-12-28");
  });
  it("meses siguientes y anteriores, cruzando el año", () => {
    expect(addMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 });
    expect(addMonths({ year: 2026, month: 2 }, -3)).toEqual({ year: 2025, month: 11 });
  });
  it("bloque de ±3 meses: de la cuadrícula de agosto a la de febrero", () => {
    expect(blockRange({ year: 2026, month: 11 })).toEqual({ from: "2026-07-27", to: "2027-02-28" });
    expect(covers({ from: "2026-07-27", to: "2027-02-28" }, 2027, 2)).toBe(true);
    expect(covers({ from: "2026-07-27", to: "2027-02-28" }, 2027, 3)).toBe(false);
  });
});

describe("marcas de cada día", () => {
  const A = "2026-11-23";
  const base = {
    from: "2026-10-26",
    to: "2026-12-06",
    shiftOf: (m: string) => shiftWeek(A, m).kind,
    suggestions: [],
    mine: [],
    runs: [],
    races: [],
    injuries: [],
    today: "2026-11-19",
  };
  it("sugerencias por tipo (tenues) y mis sesiones (mandan, primero)", () => {
    const c = buildCalendar({
      ...base,
      suggestions: [{ day: "2026-11-28", session: "tirada_larga", week: "2026-11-23" }, { day: "2026-12-02", session: "calidad_corta", week: "2026-11-30" }, { day: "2026-12-05", session: "suave_opcional", week: "2026-11-30" }],
      mine: [{ id: "m1", date: "2026-11-28", kind: "suave", detail: "8 km", note: "con Ane" }, { id: "m2", date: "2026-11-30", kind: "raro" }],
    });
    expect(c.days["2026-11-28"].plans).toEqual([
      { kind: "suave", mine: true, label: "Rodaje suave", id: "m1", detail: "8 km", note: "con Ane", distanceM: null, durationS: null, warnings: [] },
      { kind: "tirada_larga", mine: false, label: "Tirada larga", week: "2026-11-23", session: "tirada_larga" },
    ]);
    expect(c.days["2026-12-02"].plans).toEqual([{ kind: "calidad", mine: false, label: "Calidad corta", week: "2026-11-30", session: "calidad_corta" }]);
    expect(c.days["2026-12-05"].plans[0].label).toBe("Rodaje suave (opcional)");
    expect(c.days["2026-12-05"].plans[0].kind).toBe("suave");
    expect(c.days["2026-11-30"].plans[0].kind).toBe("otro");
  });
  it("«solo la carrera» no lleva punto; la carrera objetivo lleva 🏁", () => {
    expect(calKindOfSuggestion("solo_carrera")).toBeNull();
    const c = buildCalendar({ ...base, suggestions: [{ day: "2026-12-06", session: "solo_carrera", week: "2026-11-30" }], races: [{ name: "10K", date: "2026-12-06" }] });
    expect(c.days["2026-12-06"]).toEqual({ plans: [], runs: [], race: "10K", injury: false });
  });
  it("carreras hechas con km; fuera del rango no cuentan", () => {
    const c = buildCalendar({ ...base, runs: [{ id: "r1", date: "2026-11-16", distanceM: 7440, type: "cinta", paceS: 323 }, { id: "r2", date: "2026-11-16", distanceM: null }, { id: "r3", date: "2026-10-01", distanceM: 5000 }] });
    expect(c.days["2026-11-16"].runs).toEqual([{ id: "r1", km: 7.4, type: "cinta", paceS: 323 }, { id: "r2", km: null, type: null, paceS: null }]);
    expect(c.days["2026-10-01"]).toBeUndefined();
  });
  it("lesión: banda en sus días; abierta, hasta hoy", () => {
    const c = buildCalendar({ ...base, injuries: [{ startDate: "2026-11-10", endDate: null }, { startDate: "2026-10-20", endDate: "2026-10-27" }] });
    expect(c.days["2026-11-10"].injury).toBe(true);
    expect(c.days["2026-11-19"].injury).toBe(true);
    expect(c.days["2026-11-20"]).toBeUndefined();
    expect(c.days["2026-10-26"].injury).toBe(true);
    expect(c.days["2026-10-28"]).toBeUndefined();
  });
  it("turno por semana (lunes); sin ciclo, ninguno", () => {
    const c = buildCalendar(base);
    expect(c.shifts["2026-11-23"]).toBe("tardes");
    expect(c.shifts["2026-11-30"]).toBe("noches");
    expect(Object.keys(c.shifts)).toHaveLength(6);
    expect(buildCalendar({ ...base, shiftOf: null }).shifts).toEqual({});
  });
  it("unir bloques: en su rango manda el nuevo", () => {
    const a = buildCalendar({ ...base, runs: [{ id: "x", date: "2026-11-16", distanceM: 1000 }] });
    const b = buildCalendar({ ...base, from: "2026-11-16", to: "2026-11-22", runs: [] });
    const m = mergeBlocks(a, b);
    expect(m.days["2026-11-16"]).toBeUndefined();
    expect(m).toMatchObject({ from: "2026-10-26", to: "2026-12-06" });
  });
});

describe("sesión ya cubierta por una carrera de otro día de su semana", () => {
  const base = { from: "2026-11-23", to: "2026-11-29", shiftOf: null, mine: [], runs: [], races: [], injuries: [], today: "2026-11-26" };
  it("la sesión del sábado lleva la carrera del jueves («Hecha antes (jueves 26)») y la del día sigue igual", () => {
    const covered = { date: "2026-11-26", offset: -2, matched: true, when: "Hecha antes (jueves 26)" };
    const c = buildCalendar({
      ...base,
      suggestions: [{ day: "2026-11-28", session: "tirada_larga", week: "2026-11-23", covered }],
      mine: [{ id: "m", date: "2026-11-25", kind: "suave" }],
      runs: [{ id: "r", date: "2026-11-26", distanceM: 16000, type: "tirada_larga" }],
    });
    expect(c.days["2026-11-28"].plans[0].covered).toEqual(covered);
    expect(c.days["2026-11-25"].plans[0].covered).toBeUndefined();
    expect(c.days["2026-11-26"].runs[0].km).toBe(16);
  });
});
