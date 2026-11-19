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

describe("afinado antes de una carrera objetivo", () => {
  // Carrera el domingo 20-dic-2026 (semana 14–20 dic: mañanas).
  const race = [{ name: "Media de prueba", date: "2026-12-20" }];
  const ws = plan("2026-11-30", [{ date: "2026-11-28", type: "tirada_larga" }], { races: race });
  const by = Object.fromEntries(ws.map((w) => [w.start, w]));
  it("semana de la carrera: rodaje suave corto como mínimo 2 días antes, y la carrera marcada", () => {
    const w = by["2026-12-14"];
    expect(w.session).toBe("suave_corto");
    expect(dayNum(w.day)!).toBeLessThanOrEqual(dayNum("2026-12-18")!);
    expect(w.race).toMatchObject({ name: "Media de prueba", date: "2026-12-20" });
    expect(w.reason).toMatch(/al menos 2 días antes/);
  });
  it("la semana anterior: rodaje suave", () => {
    expect(by["2026-12-07"]).toMatchObject({ session: "suave" });
    expect(by["2026-12-07"].reason).toMatch(/Semana anterior a la carrera/);
  });
  it("dos semanas antes: calidad corta en lugar de la exigente; en noches, suave opcional", () => {
    // 30-nov es de noches: se queda en suave opcional
    expect(by["2026-11-30"].session).toBe("suave_opcional");
    const other = plan("2026-11-23", [{ date: "2026-11-15", type: "series" }], { races: [{ name: "10K", date: "2026-12-13" }] });
    const w = other.find((x) => x.start === "2026-11-23")!; // tardes, 2 semanas antes
    expect(w.session).toBe("calidad_corta");
    expect(w.reason).toMatch(/en lugar de la tirada larga/);
  });
  it("si la carrera es lunes o martes y ya no queda un día 2 días antes: solo la carrera", () => {
    const w = plan("2026-12-14", [{ date: "2026-12-10", type: "rodaje" }], { races: [{ name: "Martes", date: "2026-12-15" }] })[0];
    expect(w).toMatchObject({ session: "solo_carrera", day: "2026-12-15" });
  });
  it("manda sobre una semana ya guardada", () => {
    const fixed = { "2026-12-14": { session: "tirada_larga" as const, day: "2026-12-19", when: null, reason: "Guardada", downgraded: false } };
    const w = plan("2026-12-14", [{ date: "2026-12-10", type: "rodaje" }], { races: race, fixed })[0];
    expect(w.session).toBe("suave_corto");
  });
  it("sin carreras, nada cambia", () => {
    expect(plan("2026-11-30", [{ date: "2026-11-28", type: "tirada_larga" }]).map((w) => w.session)).toEqual(
      plan("2026-11-30", [{ date: "2026-11-28", type: "tirada_larga" }], { races: [] }).map((w) => w.session),
    );
  });
});

describe("recálculo alrededor de mis sesiones", () => {
  const H: PastRun[] = [{ date: "2026-11-15", type: "rodaje" }, { date: "2026-10-17", type: "tirada_larga" }];
  const base = plan("2026-11-23", H);
  const by = (ws: ReturnType<typeof plan>) => Object.fromEntries(ws.map((w) => [w.start, w]));
  it("sin sesiones mías, el plan no cambia", () => {
    expect(plan("2026-11-23", H, { mine: [] })).toEqual(base);
  });
  it("una exigente mía ocupa el sitio de la sugerencia de su semana y cuenta para alternar", () => {
    // por defecto: libre 7–13 dic calidad; mañanas 14–20 dic suave
    expect(by(base)["2026-12-07"].session).toBe("calidad");
    expect(by(base)["2026-12-14"].session).toBe("suave");
    const ws = by(plan("2026-11-23", H, { mine: [{ id: "m1", date: "2026-12-12", kind: "tirada_larga" }] }));
    expect(ws["2026-12-07"].occupiedBy).toBe("m1");
    // tras mi tirada larga, toca calidad: mañanas propone calidad corta
    expect(ws["2026-12-14"].session).toBe("calidad_corta");
  });
  it("una suave u otro mía no ocupa el sitio: la sugerencia se queda, en otro día", () => {
    expect(by(base)["2026-12-07"].day).toBe("2026-12-09");
    for (const kind of ["suave", "otro"]) {
      const w = by(plan("2026-11-23", H, { mine: [{ id: "m1", date: "2026-12-09", kind }] }))["2026-12-07"];
      expect(w.occupiedBy).toBeUndefined();
      expect(w.session).toBe("calidad");
      expect(w.day).not.toBe("2026-12-09");
    }
  });
  it("nunca el mismo tipo exigente tras una semana con exigente mía (tardes pasa a calidad)", () => {
    expect(by(base)["2026-12-28"].session).toBe("tirada_larga");
    const ws = by(plan("2026-11-23", H, { mine: [{ id: "m1", date: "2026-12-26", kind: "tirada_larga" }] }));
    expect(ws["2026-12-21"].occupiedBy).toBe("m1");
    expect(ws["2026-12-28"].session).toBe("calidad");
    expect(ws["2026-12-28"].reason).toMatch(/ya tuvo tirada larga/);
  });
  it("nunca una exigente sugerida el día después de una exigente hecha", () => {
    // hoy martes 8-dic, tirada larga corrida hoy: la calidad de la libre no va el miércoles 9
    const w = plan("2026-12-08", [{ date: "2026-12-08", type: "tirada_larga" }])[0];
    expect(w.session).toBe("calidad");
    expect(w.day).toBe("2026-12-10");
  });
  it("se mantienen las reglas de turnos: noches suave opcional; nunca calidad el lunes tras noches", () => {
    const ws = plan("2026-11-23", H, { mine: [{ id: "m1", date: "2026-12-02", kind: "suave" }, { id: "m2", date: "2026-12-26", kind: "tirada_larga" }] });
    for (const w of ws) {
      if (w.kind === "noches") expect(w.session).toBe("suave_opcional");
      if (w.session.startsWith("calidad")) expect(wd(w.day) === 0 && w.kind === "libre" && w.pos === 2).toBe(false);
    }
  });
  it("y el afinado de la carrera objetivo", () => {
    const ws = by(plan("2026-11-23", H, { mine: [{ id: "m1", date: "2026-12-12", kind: "tirada_larga" }], races: [{ name: "Media", date: "2026-12-20" }] }));
    expect(ws["2026-12-14"].session).toBe("suave_corto");
    expect(ws["2026-12-07"]).toMatchObject({ session: "suave", occupiedBy: "m1" });
  });
});
