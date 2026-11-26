import { describe, expect, it } from "vitest";
import { splitToday, todayFromMine, type TodayMineDone } from "@/lib/plan/today";

const m = (o: Partial<TodayMineDone> = {}): TodayMineDone => ({ id: "a", kind: "suave", distanceM: null, durationS: null, note: null, status: "pendiente", ...o });

describe("«Hoy» con mi sesión", () => {
  it("sin sesión mía, null (manda la estimación de siempre)", () => {
    expect(todayFromMine([], { label: "Descanso" }, false)).toBeNull();
  });
  it("«Hoy te toca: …, lo pusiste tú», con detalle y nota", () => {
    const t = todayFromMine([m({ kind: "tirada_larga", distanceM: 16000, durationS: 5400, note: "con Ane" })], { label: "Calidad" }, false)!;
    expect(t).toMatchObject({ title: "Tirada larga", sub: "lo pusiste tú · 16 km · 1 h 30 min", note: "con Ane", injury: null, done: null });
    expect(t.appNote).toBe("La estimación de la app era: Calidad.");
  });
  it("si coincide con la estimación, no se repite", () => {
    expect(todayFromMine([m()], { label: "Rodaje suave" }, false)!.appNote).toBeNull();
  });
  it("varias el mismo día", () => {
    const t = todayFromMine([m(), m({ id: "b", kind: "calidad" })], { label: "Libre" }, false)!;
    expect(t.title).toBe("Rodaje suave y calidad");
    expect(t.sub).toBe("las pusiste tú");
  });
  it("lesión abierta: avisa también (más fuerte si es exigente)", () => {
    expect(todayFromMine([m()], { label: "Descanso" }, true)!.injury).toMatch(/lesión abierta: hazlo suave/);
    expect(todayFromMine([m({ kind: "calidad" })], { label: "Descanso" }, true)!.injury).toMatch(/exigente no es buena idea/);
  });
  it("ya corrida (vinculada): lo dice", () => {
    expect(todayFromMine([m({ status: "cumplida" })], { label: "Descanso" }, false)!.done).toBe("Cumplida");
    expect(todayFromMine([m({ status: "otra" })], { label: "Descanso" }, false)!.done).toBe("Hecha, otro tipo");
  });
});

describe("«Hoy» con descanso", () => {
  it("título «Descanso», lo pusiste tú; con lesión, sin decir que corras", () => {
    const t = todayFromMine([m({ kind: "descanso" })], { label: "Rodaje suave" }, true)!;
    expect(t).toMatchObject({ title: "Descanso", sub: "lo pusiste tú" });
    expect(t.injury).toMatch(/buen día para descansar/);
  });
});

describe("«Hoy»: ya hecha antes en su semana", () => {
  const done = { dayLabel: "martes 24", typeLabel: "Tirada larga", km: "16" };
  it("la cubierta por una carrera anterior sale de «Hoy te toca» con su frase", () => {
    const r = splitToday([m({ kind: "tirada_larga", status: "cumplida", doneOffset: -2, done }), m({ id: "b", kind: "suave" })]);
    expect(r.pending.map((x) => x.id)).toEqual(["b"]);
    expect(r.doneBefore).toEqual(["Tu tirada larga de esta semana ya está hecha: martes 24 (Tirada larga · 16 km)."]);
  });
  it("cubierta con otro tipo lo dice así", () => {
    const r = splitToday([m({ kind: "calidad", status: "otra", doneOffset: -1, done: { dayLabel: "miércoles 25", typeLabel: "Rodaje", km: null } })]);
    expect(r.doneBefore).toEqual(["Tu calidad de esta semana ya la cubrió otra sesión: miércoles 25 (Rodaje)."]);
    expect(r.pending).toEqual([]);
  });
  it("corrida hoy (o pendiente) sigue en «Hoy te toca»", () => {
    expect(splitToday([m({ status: "cumplida", doneOffset: 0, done })]).pending).toHaveLength(1);
    expect(splitToday([m({ status: "pendiente" })]).doneBefore).toEqual([]);
  });
});
