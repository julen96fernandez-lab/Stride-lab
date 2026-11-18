import { describe, expect, it } from "vitest";
import { planWeeks, type PastRun } from "@/lib/plan/weekly";
import { dayNum, shiftWeeks, weekdayOf } from "@/lib/plan/shifts";

const A = "2026-11-23"; // lunes, tardes
const wd = (ymd: string) => weekdayOf(dayNum(ymd)!); // 0 = lunes
const plan = (today: string, history: PastRun[] = [{ date: "2026-11-15", type: "rodaje" }], extra: Partial<Parameters<typeof planWeeks>[0]> = {}) =>
  planWeeks({ weeks: shiftWeeks(A, today, 10), anchor: A, today, history, ratio: 1.0, openInjury: false, ...extra });

describe("una sesión por semana según el turno", () => {
  const ws = plan("2026-11-23", [{ date: "2026-11-15", type: "rodaje" }, { date: "2026-10-17", type: "tirada_larga" }]);
  const by = Object.fromEntries(ws.slice(0, 5).map((w) => [w.kind + w.pos, w]));
  it("tardes: tirada larga el sábado", () => {
    expect(by.tardes0).toMatchObject({ session: "tirada_larga", day: "2026-11-28" });
    expect(wd(by.tardes0.day)).toBe(5);
  });
  it("noches: rodaje suave opcional, nunca calidad", () => {
    expect(by.noches1.session).toBe("suave_opcional");
    expect(by.noches1.when).toMatch(/dormido/);
  });
  it("libre tras noches: la exigente y nunca el lunes", () => {
    expect(["tirada_larga", "calidad"]).toContain(by.libre2.session);
    expect(wd(by.libre2.day)).not.toBe(0);
  });
  it("mañanas: entre semana por la tarde; nunca tirada larga", () => {
    expect(wd(by.mananas3.day)).toBeLessThan(5);
    expect(by.mananas3.when).toMatch(/tarde/);
    expect(by.mananas3.session).not.toBe("tirada_larga");
  });
  it("nunca la misma sesión exigente en dos semanas seguidas, y hay de los dos tipos", () => {
    const kind = (x: string) => (x === "tirada_larga" ? "L" : x.startsWith("calidad") ? "Q" : "-");
    const seq = ws.map((w) => kind(w.session));
    for (let i = 1; i < seq.length; i++) if (seq[i] !== "-") expect(seq[i]).not.toBe(seq[i - 1]);
    expect(seq).toContain("L");
    expect(seq).toContain("Q");
  });
  it("tras una tirada larga reciente, la libre propone calidad; tras calidad, tirada larga", () => {
    const tras = (type: string) => plan("2026-12-07", [{ date: "2026-12-05", type }]).find((w) => w.kind === "libre")!.session;
    expect(tras("tirada_larga")).toBe("calidad");
    expect(tras("series")).toBe("tirada_larga");
  });
  it("nunca calidad el día después de una noche (lunes tras la semana de noches)", () => {
    for (const today of ["2026-12-07", "2027-01-11", "2027-02-15"]) {
      for (const w of plan(today, [{ date: "2026-12-01", type: "tirada_larga" }])) {
        if (w.session.startsWith("calidad")) {
          const d = dayNum(w.day)!;
          expect(!(wd(w.day) === 0 && w.kind === "libre" && w.pos === 2)).toBe(true);
          expect(d).toBeGreaterThan(0);
        }
      }
    }
  });
  it("nunca dos tiradas largas en semanas seguidas (la libre antes de tardes es de calidad)", () => {
    for (const today of ["2026-11-18", "2026-12-21", "2027-03-01"]) {
      const s = plan(today, [{ date: "2026-10-17", type: "tirada_larga" }]);
      for (let i = 1; i < s.length; i++) {
        if (s[i].session === "tirada_larga") expect(s[i - 1].session).not.toBe("tirada_larga");
      }
      for (const w of s) if (w.kind === "libre" && w.pos === 4 && !w.downgraded) expect(w.session).toBe("calidad");
    }
  });
  it("el motivo cabe en una línea", () => {
    for (const w of ws) {
      expect(w.reason).not.toMatch(/\n/);
      expect(w.reason.length).toBeLessThan(160);
    }
  });
});

describe("día de la semana en curso", () => {
  it("nunca antes de hoy si queda un día válido", () => {
    expect(plan("2026-11-29")[0]).toMatchObject({ kind: "tardes", day: "2026-11-29" }); // domingo: el sábado ya pasó
    expect(plan("2026-11-25")[0].day).toBe("2026-11-28");
  });
});

describe("prudencia: baja a suave", () => {
  it("lesión abierta: todas las semanas, suave", () => {
    const ws = plan("2026-11-23", undefined, { openInjury: true });
    for (const w of ws) expect(["suave", "suave_opcional"]).toContain(w.session);
    expect(ws[0].reason).toMatch(/lesión abierta/);
  });
  it("carga alta: solo la semana en curso", () => {
    const ws = plan("2026-11-23", undefined, { ratio: 1.45 });
    expect(ws[0]).toMatchObject({ session: "suave", downgraded: true });
    expect(ws[0].reason).toMatch(/carga alta \(ratio 1,45\)/);
    expect(ws[5].session).toBe("tirada_larga");
  });
  it("más de 3 semanas sin correr: la semana en curso, suave", () => {
    expect(plan("2026-11-23", [{ date: "2026-10-20", type: "rodaje" }])[0]).toMatchObject({ session: "suave", downgraded: true });
    expect(plan("2026-11-23", [])[0].session).toBe("suave");
  });
});

describe("semanas guardadas (congeladas)", () => {
  it("se respetan tal cual al recalcular y la alternancia sigue desde ellas", () => {
    const fixed = { "2026-12-07": { session: "tirada_larga" as const, day: "2026-12-10", when: null, reason: "Guardada", downgraded: false } };
    const ws = plan("2026-12-07", [{ date: "2026-12-05", type: "tirada_larga" }], { fixed });
    expect(ws[0]).toMatchObject({ session: "tirada_larga", day: "2026-12-10", reason: "Guardada", dayLabel: "jueves 10" });
    // la siguiente exigente (mañanas) alterna desde la guardada: calidad corta
    expect(ws[1]).toMatchObject({ kind: "mananas", session: "calidad_corta" });
  });
});
