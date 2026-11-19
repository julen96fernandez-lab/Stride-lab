import { describe, expect, it } from "vitest";
import { todayFromMine, type TodayMine } from "@/lib/plan/today";

const m = (o: Partial<TodayMine> = {}): TodayMine => ({ id: "a", kind: "suave", distanceM: null, durationS: null, note: null, status: "pendiente", ...o });

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
