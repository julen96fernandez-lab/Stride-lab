import { describe, expect, it } from "vitest";
import { CYCLE, afterNights, dayNum, isMonday, shiftWeek, shiftWeeks } from "@/lib/plan/shifts";

const A = "2026-11-23"; // lunes, inicio de un bloque de tardes

describe("ciclo de turnos de 5 semanas", () => {
  it("el orden es tardes → noches → libre → mañanas → libre", () => {
    expect(CYCLE).toEqual(["tardes", "noches", "libre", "mananas", "libre"]);
  });
  it("cada bloque va de lunes a domingo; cambio de semana en la noche del domingo al lunes", () => {
    expect(shiftWeek(A, "2026-11-23")).toMatchObject({ start: "2026-11-23", end: "2026-11-29", kind: "tardes", offset: 0 });
    expect(shiftWeek(A, "2026-11-29").kind).toBe("tardes"); // domingo
    expect(shiftWeek(A, "2026-11-30")).toMatchObject({ kind: "noches", start: "2026-11-30" }); // lunes siguiente
    expect(shiftWeek(A, "2026-12-07").kind).toBe("libre");
    expect(shiftWeek(A, "2026-12-14").kind).toBe("mananas");
    expect(shiftWeek(A, "2026-12-21")).toMatchObject({ kind: "libre", pos: 4 });
    expect(shiftWeek(A, "2026-12-28")).toMatchObject({ kind: "tardes", pos: 0, offset: 5 }); // vuelta a empezar
  });
  it("cambio de año: la semana del 28-dic-2026 al 3-ene-2027 es una sola (tardes)", () => {
    const w = shiftWeek(A, "2027-01-01");
    expect(w).toMatchObject({ start: "2026-12-28", end: "2027-01-03", kind: "tardes" });
    expect(shiftWeek(A, "2027-01-04").kind).toBe("noches");
  });
  it("hacia atrás desde el ancla", () => {
    expect(shiftWeek(A, "2026-11-22")).toMatchObject({ kind: "libre", pos: 4, offset: -1, start: "2026-11-16" });
    expect(shiftWeek(A, "2026-11-09")).toMatchObject({ kind: "mananas", offset: -2 });
    expect(shiftWeek(A, "2026-11-02")).toMatchObject({ kind: "libre", pos: 2, offset: -3 });
    expect(shiftWeek(A, "2026-10-26")).toMatchObject({ kind: "noches", offset: -4 });
    expect(shiftWeek(A, "2026-10-19")).toMatchObject({ kind: "tardes", offset: -5 });
    expect(shiftWeek(A, "2025-12-31").kind).toBe(shiftWeek(A, "2025-12-29").kind); // misma semana
  });
  it("muy lejos en ambos sentidos sigue siendo periódico", () => {
    for (const k of [-60, -7, 0, 13, 104]) {
      const d = dayNum(A)! + 7 * k * 5;
      expect(shiftWeek(A, new Date(d * 86_400_000).toISOString().slice(0, 10)).kind).toBe("tardes");
    }
  });
  it("sin efecto del cambio de hora (último domingo de marzo y de octubre)", () => {
    expect(shiftWeek(A, "2027-03-28").end).toBe("2027-03-28");
    expect(shiftWeek(A, "2027-03-29").start).toBe("2027-03-29");
    expect(shiftWeek(A, "2026-10-25").end).toBe("2026-10-25");
  });
  it("próximas semanas", () => {
    const ws = shiftWeeks(A, "2026-11-25", 6);
    expect(ws.map((w) => w.kind)).toEqual(["tardes", "noches", "libre", "mananas", "libre", "tardes"]);
    expect(ws[5].start).toBe("2026-12-28");
  });
  it("el ancla debe ser un lunes real", () => {
    expect(isMonday("2026-11-23")).toBe(true);
    expect(isMonday("2026-11-24")).toBe(false);
    expect(isMonday("2026-02-30")).toBe(false);
    expect(() => shiftWeek("2026-11-24", "2026-11-25")).toThrow(/lunes/);
  });
  it("el lunes que sigue a la semana de noches", () => {
    expect(afterNights(A, dayNum("2026-12-07")!)).toBe(true); // lunes de la libre tras noches
    expect(afterNights(A, dayNum("2026-12-08")!)).toBe(false);
    expect(afterNights(A, dayNum("2026-12-21")!)).toBe(false); // libre tras mañanas
  });
});
