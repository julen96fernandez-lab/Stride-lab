import { describe, expect, it } from "vitest";
import { mineDateError, durationField, fmtDuration, isMineKind, mineDetail, mineKindForToday, mineKindOf, parseDuration, parseMineForm, weekOf } from "@/lib/plan/mine";

const T = "2026-11-18";
const base = { date: "2026-11-21", kind: "tirada_larga" };

describe("sesiones mías: formulario", () => {
  it("válida con lo mínimo (fecha y tipo)", () => {
    const { input, errors } = parseMineForm(base, T);
    expect(errors).toEqual({});
    expect(input).toEqual({ date: "2026-11-21", kind: "tirada_larga", distanceM: null, durationS: null, note: null, replacesWeek: null });
  });
  it("distancia, duración y nota opcionales", () => {
    const { input } = parseMineForm({ ...base, distanceKm: "12,5", duration: "1:10", note: "  con Ane  " }, T);
    expect(input).toMatchObject({ distanceM: 12500, durationS: 4200, note: "con Ane" });
  });
  it("errores claros", () => {
    const { input, errors } = parseMineForm({ date: "", kind: "x", distanceKm: "0,2", duration: "abc", note: "a".repeat(201) }, T);
    expect(input).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["date", "distance", "duration", "kind", "note"]);
  });
  it("fechas: hasta 4 semanas atrás y un año adelante", () => {
    expect(parseMineForm({ ...base, date: "2026-10-21" }, T).errors.date).toBeUndefined();
    expect(parseMineForm({ ...base, date: "2026-10-20" }, T).errors.date).toBeDefined();
    expect(parseMineForm({ ...base, date: "2027-11-18" }, T).errors.date).toBeUndefined();
    expect(parseMineForm({ ...base, date: "2027-11-19" }, T).errors.date).toBeDefined();
    expect(parseMineForm({ ...base, date: "2026-02-30" }, T).errors.date).toBeDefined();
  });
  it("la semana que sustituye solo si es un lunes", () => {
    expect(parseMineForm({ ...base, replacesWeek: "2026-11-16" }, T).input!.replacesWeek).toBe("2026-11-16");
    expect(parseMineForm({ ...base, replacesWeek: "2026-11-17" }, T).input!.replacesWeek).toBeNull();
    expect(parseMineForm({ ...base, replacesWeek: "basura" }, T).input!.replacesWeek).toBeNull();
  });
});

describe("sesiones mías: duración y formato", () => {
  it("minutos, h:mm y h:mm:ss", () => {
    expect(parseDuration("45")).toBe(2700);
    expect(parseDuration("45 min")).toBe(2700);
    expect(parseDuration("1:15")).toBe(4500);
    expect(parseDuration("1:15:30")).toBe(4530);
    expect(parseDuration("1:75")).toBeNull();
  });
  it("límites de 5 min a 6 h", () => {
    expect(parseMineForm({ ...base, duration: "4" }, T).errors.duration).toBeDefined();
    expect(parseMineForm({ ...base, duration: "6:00" }, T).errors.duration).toBeUndefined();
    expect(parseMineForm({ ...base, duration: "6:01" }, T).errors.duration).toBeDefined();
  });
  it("texto y campo", () => {
    expect(fmtDuration(2700)).toBe("45 min");
    expect(fmtDuration(4500)).toBe("1 h 15 min");
    expect(fmtDuration(7200)).toBe("2 h");
    expect(durationField(4500)).toBe("1:15");
    expect(durationField(2700)).toBe("45");
    expect(durationField(null)).toBe("");
    expect(mineDetail({ distanceM: 12500, durationS: 4200 })).toBe("12,5 km · 1 h 10 min");
    expect(mineDetail({ distanceM: null, durationS: null })).toBeNull();
  });
});

describe("sesiones mías: traducciones", () => {
  it("sugerencia → tipo mío", () => {
    expect(mineKindOf("tirada_larga")).toBe("tirada_larga");
    expect(mineKindOf("calidad")).toBe("calidad");
    expect(mineKindOf("calidad_corta")).toBe("calidad");
    expect(mineKindOf("suave_opcional")).toBe("suave");
    expect(mineKindOf("suave_corto")).toBe("suave");
    expect(mineKindOf("solo_carrera")).toBe("suave");
  });
  it("«Voy a correr hoy»: calidad si toca; si no, suave (también con descanso o libre)", () => {
    expect(mineKindForToday("calidad")).toBe("calidad");
    expect(mineKindForToday("descanso")).toBe("suave");
    expect(mineKindForToday("libre")).toBe("suave");
  });
  it("tipos y lunes de la semana", () => {
    expect(isMineKind("otro")).toBe(true);
    expect(isMineKind("series")).toBe(false);
    expect(weekOf("2026-11-22")).toBe("2026-11-16");
    expect(weekOf("2026-11-23")).toBe("2026-11-23");
  });
});

describe("mover: fecha válida", () => {
  it("de 4 semanas atrás a un año adelante", () => {
    expect(mineDateError("2026-11-21", "2026-11-18")).toBeNull();
    expect(mineDateError("2026-10-21", "2026-11-18")).toBeNull();
    expect(mineDateError("2026-10-20", "2026-11-18")).toMatch(/4 semanas/);
    expect(mineDateError("2027-11-19", "2026-11-18")).toMatch(/un año/);
    expect(mineDateError("2026-02-30", "2026-11-18")).toBe("Elige una fecha.");
    expect(mineDateError("", "2026-11-18")).toBe("Elige una fecha.");
  });
});

describe("descanso", () => {
  it("es un tipo mío y no lleva distancia ni duración", () => {
    expect(isMineKind("descanso")).toBe(true);
    const { input } = parseMineForm({ date: "2026-11-21", kind: "descanso", distanceKm: "10", duration: "45", note: "piernas" }, T);
    expect(input).toMatchObject({ kind: "descanso", distanceM: null, durationS: null, note: "piernas" });
  });
});
