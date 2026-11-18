import { describe, expect, it } from "vitest";
import { matchesSession, rescheduleDay, weekStatus } from "@/lib/plan/compliance";

const A = "2026-11-23";
const st = (session: Parameters<typeof weekStatus>[0]["session"], today: string, runs: { date: string; type: string | null }[] = [], day = "2026-11-28") =>
  weekStatus({ session, day, weekStart: "2026-11-23", today, runs });

describe("previsto frente a realizado", () => {
  it("cumplida con una carrera del tipo previsto en la semana", () => {
    expect(st("tirada_larga", "2026-11-29", [{ date: "2026-11-29", type: "tirada_larga" }])).toBe("cumplida");
    expect(st("calidad", "2026-11-26", [{ date: "2026-11-25", type: "series" }])).toBe("cumplida");
    expect(st("calidad_corta", "2026-11-26", [{ date: "2026-11-25", type: "tempo" }])).toBe("cumplida");
    expect(st("suave", "2026-11-26", [{ date: "2026-11-24", type: "rodaje" }])).toBe("cumplida");
  });
  it("otra sesión si se corrió pero de otro tipo", () => {
    expect(st("tirada_larga", "2026-11-30", [{ date: "2026-11-28", type: "rodaje" }])).toBe("otra");
  });
  it("las carreras de otras semanas no cuentan (domingo y lunes de los bordes)", () => {
    expect(st("tirada_larga", "2026-11-25", [{ date: "2026-11-22", type: "tirada_larga" }, { date: "2026-11-30", type: "tirada_larga" }])).toBe("pendiente");
  });
  it("pendiente, día pasado y no cumplida", () => {
    expect(st("tirada_larga", "2026-11-28")).toBe("pendiente"); // es hoy
    expect(st("tirada_larga", "2026-11-29")).toBe("dia_pasado"); // pasó el sábado, queda el domingo
    expect(st("tirada_larga", "2026-11-30")).toBe("no_cumplida"); // semana acabada
  });
  it("opcional (noches): sin correr no es un fallo", () => {
    expect(st("suave_opcional", "2026-11-30")).toBe("opcional");
    expect(st("suave_opcional", "2026-11-29")).toBe("pendiente");
  });
  it("qué carrera cumple cada sesión", () => {
    expect(matchesSession("tirada_larga", "rodaje")).toBe(false);
    expect(matchesSession("calidad", "competicion")).toBe(true);
    expect(matchesSession("suave_opcional", "trail")).toBe(true);
  });
});

describe("reorganizar con las mismas reglas", () => {
  it("tardes: solo fin de semana; si pasó el sábado, el domingo; si pasó todo, nada", () => {
    expect(rescheduleDay({ anchor: A, kind: "tardes", session: "tirada_larga", weekStart: "2026-11-23", today: "2026-11-29" })).toBe("2026-11-29");
    expect(rescheduleDay({ anchor: A, kind: "tardes", session: "tirada_larga", weekStart: "2026-11-23", today: "2026-11-25" })).toBe("2026-11-28");
  });
  it("mañanas: entre semana; el sábado ya no vale", () => {
    expect(rescheduleDay({ anchor: A, kind: "mananas", session: "calidad_corta", weekStart: "2026-12-14", today: "2026-12-17" })).toBe("2026-12-17");
    expect(rescheduleDay({ anchor: A, kind: "mananas", session: "calidad_corta", weekStart: "2026-12-14", today: "2026-12-19" })).toBeNull();
  });
  it("libre tras noches: nunca el lunes", () => {
    expect(rescheduleDay({ anchor: A, kind: "libre", session: "calidad", weekStart: "2026-12-07", today: "2026-12-07" })).toBe("2026-12-08");
  });
  it("cambio de año dentro de la semana", () => {
    expect(rescheduleDay({ anchor: A, kind: "tardes", session: "tirada_larga", weekStart: "2026-12-28", today: "2026-12-31" })).toBe("2027-01-02");
  });
});
