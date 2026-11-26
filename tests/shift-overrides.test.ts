import { describe, expect, it } from "vitest";
import { afterNightOn, afterNights, dayNum, demandingOkOn, nightOn, shiftOn } from "@/lib/plan/shifts";
import { planWeeks, type PastRun } from "@/lib/plan/weekly";
import { shiftWeeks } from "@/lib/plan/shifts";
import { mineWarnings } from "@/lib/plan/warnings";
import { rescheduleDay } from "@/lib/plan/compliance";
import { shiftAdvice, TODAY_LABEL } from "@/lib/analysis/home";
import { todayFromMine } from "@/lib/plan/today";
import { blockRange, buildCalendar, mergeBlocks } from "@/lib/plan/calendar";

const A = "2026-11-23"; // tardes 23–29 nov; noches 30 nov–6 dic; libre 7–13; mañanas 14–20; libre 21–27
const n = (ymd: string) => dayNum(ymd)!;

describe("turno efectivo de un día", () => {
  it("el cambiado o, si no, el del bloque", () => {
    expect(shiftOn(A, "2026-12-09")).toBe("libre");
    expect(shiftOn(A, "2026-12-09", { "2026-12-09": "noches" })).toBe("noches");
    expect(shiftOn(A, "2026-12-03", { "2026-12-03": "libre" })).toBe("libre");
  });
  it("sin cambios, «tras una noche» es lo de siempre (el lunes que sigue a las noches)", () => {
    for (let d = n("2026-11-23"); d < n("2027-03-01"); d++) expect(afterNightOn(A, d)).toBe(afterNights(A, d));
  });
  it("una «Noche» en un día: ese día de noche y el siguiente tras una noche", () => {
    const ov = { "2026-12-09": "noches" as const };
    expect(nightOn(A, n("2026-12-09"), ov)).toBe(true);
    expect(afterNightOn(A, n("2026-12-10"), ov)).toBe(true);
    expect(demandingOkOn(A, n("2026-12-09"), ov)).toBe(false);
    expect(demandingOkOn(A, n("2026-12-10"), ov)).toBe(false);
    expect(demandingOkOn(A, n("2026-12-11"), ov)).toBe(true);
  });
  it("un «Libre» dentro de noches quita las restricciones salvo que el día anterior fuera noche", () => {
    // miércoles 2 libre: el martes 1 fue noche → sigue siendo «tras una noche»
    expect(demandingOkOn(A, n("2026-12-02"), { "2026-12-02": "libre" })).toBe(false);
    // martes 1 y miércoles 2 libres: el miércoles queda libre del todo
    expect(demandingOkOn(A, n("2026-12-02"), { "2026-12-01": "libre", "2026-12-02": "libre" })).toBe(true);
    // domingo 6 libre: el lunes 7 ya no es «tras una noche»
    expect(afterNightOn(A, n("2026-12-07"), { "2026-12-06": "libre" })).toBe(false);
  });
});

describe("las sugerencias usan el turno efectivo de cada día", () => {
  const H: PastRun[] = [{ date: "2026-11-15", type: "rodaje" }, { date: "2026-10-17", type: "tirada_larga" }];
  const plan = (ov?: Record<string, "noches" | "libre" | "mananas" | "tardes">) =>
    planWeeks({ weeks: shiftWeeks(A, "2026-11-23", 6), anchor: A, today: "2026-11-23", history: H, ratio: 1, openInjury: false, overrides: ov });
  const w = (ws: ReturnType<typeof plan>, start: string) => ws.find((x) => x.start === start)!;
  it("una noche el día sugerido mueve la exigente a un día válido", () => {
    const base = w(plan(), "2026-12-07");
    expect(base).toMatchObject({ session: "calidad", day: "2026-12-09" });
    const moved = w(plan({ "2026-12-09": "noches" }), "2026-12-07");
    expect(moved.session).toBe("calidad");
    expect(["2026-12-09", "2026-12-10"]).not.toContain(moved.day);
  });
  it("la tirada larga de tardes esquiva un sábado de noche (y el domingo tras ella): sin día válido, rodaje suave", () => {
    const ws = plan({ "2026-11-28": "noches" });
    expect(w(ws, "2026-11-23")).toMatchObject({ session: "suave", downgraded: true });
    expect(w(ws, "2026-11-23").reason).toMatch(/Cambios de turno/);
    expect(w(plan({ "2026-11-29": "noches" }), "2026-11-23")).toMatchObject({ session: "tirada_larga", day: "2026-11-28" });
  });
  it("el momento del día sigue al turno cambiado de ese día", () => {
    const ws = plan({ "2026-12-16": "tardes" });
    const m = w(ws, "2026-12-14");
    if (m.day === "2026-12-16") expect(m.when).toBe("por la mañana, antes del turno");
    const ws2 = plan({ "2026-12-15": "libre", "2026-12-16": "libre", "2026-12-17": "libre" });
    expect(w(ws2, "2026-12-14").when).toBeNull();
  });
});

describe("avisos y «Reorganizar» con el turno efectivo", () => {
  const ctx = (ov: Record<string, "noches" | "libre">) => ({ anchor: A, races: [], exigentes: [], overrides: ov });
  it("día de noche (cambiado) y el siguiente", () => {
    expect(mineWarnings({ date: "2026-12-09", kind: "calidad" }, ctx({ "2026-12-09": "noches" }))).toEqual(["Día de noche (turno cambiado): solo rodaje suave u opcional."]);
    expect(mineWarnings({ date: "2026-12-10", kind: "tirada_larga" }, ctx({ "2026-12-09": "noches" }))).toEqual(["Tras una noche: nada exigente ese día (regla de turnos)."]);
    expect(mineWarnings({ date: "2026-12-09", kind: "suave" }, ctx({ "2026-12-09": "noches" }))).toEqual([]);
  });
  it("un libre dentro de noches sin noche la víspera: sin aviso", () => {
    expect(mineWarnings({ date: "2026-12-02", kind: "calidad" }, ctx({ "2026-12-01": "libre", "2026-12-02": "libre" }))).toEqual([]);
  });
  it("«Reorganizar» salta los días de noche y los de después", () => {
    const o = { anchor: A, kind: "libre" as const, session: "calidad" as const, weekStart: "2026-12-07", today: "2026-12-10" };
    expect(rescheduleDay(o)).toBe("2026-12-10");
    expect(rescheduleDay({ ...o, overrides: { "2026-12-10": "noches" } })).toBe("2026-12-12");
  });
});

describe("«Hoy» con el turno efectivo", () => {
  const adv = (kind: "calidad" | "suave" | "libre" | "descanso") => ({ kind, label: TODAY_LABEL[kind], reason: "Base." });
  it("hoy de noche: como mucho suave; tras una noche: nada exigente; el descanso se queda", () => {
    expect(shiftAdvice(adv("calidad"), { night: true, afterNight: false })).toMatchObject({ kind: "suave", reason: expect.stringMatching(/turno de noche/) });
    expect(shiftAdvice(adv("suave"), { night: true, afterNight: false }).reason).toMatch(/Hoy tienes noche/);
    expect(shiftAdvice(adv("libre"), { night: false, afterNight: true })).toMatchObject({ kind: "suave", reason: expect.stringMatching(/Ayer tuviste noche/) });
    expect(shiftAdvice(adv("descanso"), { night: true, afterNight: false }).kind).toBe("descanso");
    expect(shiftAdvice(adv("calidad"), null).kind).toBe("calidad");
  });
  it("mi sesión exigente de hoy con noche: aviso, pero se queda como la puse", () => {
    const m = { id: "a", kind: "calidad" as const, distanceM: null, durationS: null, note: null, status: "pendiente" as const };
    const t = todayFromMine([m], { label: "Rodaje suave" }, false, { night: false, afterNight: true })!;
    expect(t.title).toBe("Calidad");
    expect(t.shiftWarning).toMatch(/Ayer tuviste noche/);
    expect(todayFromMine([{ ...m, kind: "suave" }], { label: "Rodaje suave" }, false, { night: true, afterNight: false })!.shiftWarning).toBeNull();
  });
});

describe("calendario: cambios de turno por día", () => {
  it("van en el bloque (cambio de mes y de año) y se unen al cargar otro", () => {
    const r = blockRange({ year: 2026, month: 12 });
    const base = { shiftOf: null, suggestions: [], mine: [], runs: [], races: [], injuries: [], today: "2026-11-26" };
    const a = buildCalendar({ ...base, ...r, overrides: { "2027-01-04": "noches", "2025-01-01": "libre" } });
    expect(a.overrides).toEqual({ "2027-01-04": "noches" });
    const b = buildCalendar({ ...base, ...blockRange({ year: 2027, month: 6 }), overrides: { "2027-06-10": "tardes" } });
    expect(mergeBlocks(a, b).overrides).toEqual({ "2027-01-04": "noches", "2027-06-10": "tardes" });
  });
});
