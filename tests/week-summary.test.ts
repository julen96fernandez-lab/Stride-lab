import { describe, expect, it } from "vitest";
import { WEEK_RULES, summarizeWeek, type WeekInput, type WeekRun } from "@/lib/analysis/week-summary";
import { addDaysYmd, mondayOf } from "@/lib/analysis/week-dates";

const r = (id: string, date: string, km: number, o: Partial<WeekRun> = {}): WeekRun => ({
  id, date, distanceM: km * 1000, durationS: km * 330, type: "rodaje", typeLabel: "Rodaje", load: 50, rating: null, ...o,
});
const base = (o: Partial<WeekInput> = {}): WeekInput => ({
  start: "2026-11-16", today: "2026-11-26", runs: [], prevKm: [], goalKm: null, plan: [], unplanned: 0, injury: false, ...o,
});
const text = (s: ReturnType<typeof summarizeWeek>) => s.lines.map((l) => l.text).join(" ");

describe("fechas", () => {
  it("lunes de la semana y sumar días cruzando año", () => {
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
    expect(addDaysYmd("2026-12-28", 6)).toBe("2027-01-03");
  });
});

describe("resumen de la semana: cifras", () => {
  const s = summarizeWeek(base({ runs: [r("a", "2026-11-17", 8), r("b", "2026-11-21", 14.2, { type: "tirada_larga", typeLabel: "Tirada larga", load: null }), r("c", "2026-11-24", 5)] }));
  it("solo las carreras de la semana; km, tiempo, carga con dato, la más larga, por tipo y por día", () => {
    expect(s).toMatchObject({ start: "2026-11-16", end: "2026-11-22", inProgress: false, runs: 2, loadRuns: 1, load: 50 });
    expect(s.km).toBeCloseTo(22.2);
    expect(s.longest).toEqual({ km: 14.2, date: "2026-11-21", typeLabel: "Tirada larga" });
    expect(s.byType.map((t) => t.label)).toEqual(["Tirada larga", "Rodaje"]);
    expect(s.daily.map((x) => Math.round(x * 10) / 10)).toEqual([0, 8, 0, 0, 0, 14.2, 0]);
  });
  it("semana en curso: días que quedan (incluido hoy)", () => {
    const c = summarizeWeek(base({ start: "2026-11-23", today: "2026-11-26" }));
    expect(c).toMatchObject({ inProgress: true, daysLeft: 4 });
    expect(c.lines[0].text).toBe("Esta semana aún no has corrido.");
  });
});

describe("resumen de la semana: frases", () => {
  it("sin carreras ni nada más: una sola frase", () => {
    expect(summarizeWeek(base()).lines).toEqual([{ text: "Semana sin carreras.", tone: "neutral" }]);
  });
  it("volumen", () => {
    expect(summarizeWeek(base({ runs: [r("a", "2026-11-17", 8)] })).lines[0].text).toBe("Semana de 8 km en 1 carrera (44 min).");
  });
  it("previsto frente a realizado con el cumplimiento por semana (otro día y vínculo manual cuentan)", () => {
    const all = summarizeWeek(base({ plan: [
      { label: "Calidad", mine: true, day: "2026-11-19", status: "cumplida", doneWhen: "Hecha antes (martes 17)" },
      { label: "Rodaje suave", mine: false, day: "2026-11-22", status: "cumplida", manual: true },
    ] }));
    expect(all.lines.find((l) => /Previsto/.test(l.text))).toEqual({ text: "Previsto frente a realizado: cumpliste las 2 sesiones previstas (1 en otro día de la semana).", tone: "good" });
    expect(all.plan).toMatchObject({ total: 2, done: 2, otherDay: 1, manual: 1 });
    const mixed = summarizeWeek(base({ plan: [
      { label: "Calidad", mine: true, day: "2026-11-19", status: "cumplida" },
      { label: "Tirada larga", mine: false, day: "2026-11-21", status: "otra" },
      { label: "Rodaje suave", mine: true, day: "2026-11-20", status: "no_hecha" },
      { label: "Descanso", mine: true, day: "2026-11-18", status: "descanso" },
      { label: "Opcional", mine: false, day: "2026-11-22", status: "opcional" },
    ] }));
    expect(mixed.lines.find((l) => /Previsto/.test(l.text))).toEqual({ text: "Previsto frente a realizado: 1 de 3 cumplidas; 1 hecha con otro tipo; 1 sin hacer.", tone: "watch" });
  });
  it("una sola sesión hecha otro día: sin el número", () => {
    const one = summarizeWeek(base({ plan: [{ label: "Calidad", mine: true, day: "2026-11-19", status: "cumplida", doneWhen: "Hecha antes (martes 17)" }] }));
    expect(one.lines.find((l) => /Previsto/.test(l.text))!.text).toBe("Previsto frente a realizado: cumpliste la sesión prevista (en otro día de la semana).");
  });
  it("en curso: pendientes (y el día pasado aún cuenta como pendiente); cerrada: sin hacer", () => {
    const p = [{ label: "Calidad", mine: false, day: "2026-11-24", status: "dia_pasado" as const }];
    expect(text(summarizeWeek(base({ start: "2026-11-23", plan: p })))).toMatch(/0 de 1 cumplidas; 1 pendiente\./);
    expect(text(summarizeWeek(base({ start: "2026-11-23", today: "2026-11-30", plan: p })))).toMatch(/0 de 1 cumplidas; 1 sin hacer\./);
  });
  it("sin plan no hay «previsto frente a realizado» ni «no previstas»", () => {
    expect(text(summarizeWeek(base({ runs: [r("a", "2026-11-17", 8)], unplanned: 1 })))).not.toMatch(/Previsto|no prevista/);
  });
  it("objetivo: cumplido (bien), faltaron, o en curso", () => {
    const runs = [r("a", "2026-11-17", 20), r("b", "2026-11-19", 12)];
    expect(summarizeWeek(base({ runs, goalKm: 30 })).lines.find((l) => /Objetivo/.test(l.text))).toEqual({ text: "Objetivo semanal cumplido: 32 de 30 km.", tone: "good" });
    expect(text(summarizeWeek(base({ runs, goalKm: 40 })))).toMatch(/Faltaron 8 km para el objetivo \(32 de 40\)\./);
    expect(text(summarizeWeek(base({ start: "2026-11-23", runs: [r("c", "2026-11-24", 10)], goalKm: 30 })))).toMatch(/Llevas 10 de 30 km del objetivo; quedan 4 días\./);
  });
  it("frente a la media de las 8 anteriores, sin alertas; con menos de 2 semanas con datos, no compara", () => {
    const runs = [r("a", "2026-11-17", 30)];
    const up = summarizeWeek(base({ runs, prevKm: [20, 20, 20, 20, 20, 20, 20, 20, 99] }));
    expect(up.lines.find((l) => /media/.test(l.text))).toEqual({ text: "Volumen un 50 % por encima de la media de tus 8 semanas anteriores (20 km).", tone: "neutral" });
    expect(text(summarizeWeek(base({ runs, prevKm: [29, 31] })))).toMatch(/Volumen parecido a la media de tus 2 semanas anteriores \(30 km\)\./);
    expect(text(summarizeWeek(base({ runs, prevKm: [30, 0, 0] })))).not.toMatch(/media/);
    expect(text(summarizeWeek(base({ start: "2026-11-23", runs: [r("c", "2026-11-24", 10)], prevKm: [20, 20] })))).not.toMatch(/media/);
  });
  it("la más larga (con 2 o más carreras), sensaciones (con 2 valoradas) y lesión como coincidencia", () => {
    const s = summarizeWeek(base({ runs: [r("a", "2026-11-17", 8, { rating: 4 }), r("b", "2026-11-21", 14, { typeLabel: "Tirada larga", rating: 5 })], injury: true }));
    expect(text(s)).toMatch(/La más larga: 14 km \(Tirada larga, sábado 21\)\./);
    expect(s.lines.find((l) => /Sensaciones/.test(l.text))).toEqual({ text: "Sensaciones: media de 4,5 sobre 5 en 2 carreras valoradas.", tone: "good" });
    expect(text(s)).toMatch(/Coincidió con un periodo de lesión\./);
    expect(text(summarizeWeek(base({ runs: [r("a", "2026-11-17", 8, { rating: 1 })] })))).not.toMatch(/Sensaciones/);
  });
  it("como mucho 5 frases y nunca causas", () => {
    const s = summarizeWeek(base({
      runs: [r("a", "2026-11-17", 8, { rating: 2 }), r("b", "2026-11-21", 14, { rating: 2 })],
      prevKm: [10, 10], goalKm: 50, injury: true, unplanned: 1,
      plan: [{ label: "Calidad", mine: true, day: "2026-11-19", status: "no_hecha" }],
    }));
    expect(s.lines).toHaveLength(WEEK_RULES.maxLines);
    expect(text(s)).not.toMatch(/por culpa|porque|debido|causa/i);
  });
});
