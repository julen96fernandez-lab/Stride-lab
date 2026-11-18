import { describe, expect, it } from "vitest";
import { recommendToday, weekDays, type RunForToday } from "@/lib/analysis/home";

// Miércoles 18-nov-2026, 12:00 en Madrid
const NOW = new Date("2026-11-18T11:00:00Z");
const day = (d: number, h = 8): Date => new Date(Date.UTC(2026, 10, 18 - d, h, 0)); // hace d días
const run = (daysAgo: number, type: string | null, load: number | null = 100, km = 10): RunForToday => ({ startAt: day(daysAgo), distanceM: km * 1000, type, trainingLoad: load });
/** Base de 28 días con carga media 100 (rodajes cada 3 días a partir de hace 5). */
const base = [5, 8, 11, 14, 17, 20, 23].map((d) => run(d, "rodaje", 100));

describe("recomendación de hoy", () => {
  it("periodo de lesión abierto → descanso", () => {
    const r = recommendToday({ runs: [run(1, "rodaje"), ...base], openInjury: true, now: NOW });
    expect(r.kind).toBe("descanso");
    expect(r.reason).toMatch(/lesión/);
  });

  it("sin carreras → libre, sin inventar", () => {
    expect(recommendToday({ runs: [], openInjury: false, now: NOW }).kind).toBe("libre");
  });

  it("ya ha corrido hoy → descanso", () => {
    const r = recommendToday({ runs: [run(0, "rodaje", 90, 8), ...base], openInjury: false, now: NOW });
    expect(r.kind).toBe("descanso");
    expect(r.reason).toMatch(/Hoy ya has corrido \(8 km/);
  });

  it("series, tirada larga o competición ayer → suave o descanso", () => {
    expect(recommendToday({ runs: [run(1, "series", 110), ...base], openInjury: false, now: NOW })).toMatchObject({ kind: "suave", label: "Rodaje suave" });
    expect(recommendToday({ runs: [run(1, "tirada_larga", 120), ...base], openInjury: false, now: NOW }).kind).toBe("suave");
    expect(recommendToday({ runs: [run(1, "competicion", 120), ...base], openInjury: false, now: NOW }).kind).toBe("descanso");
  });

  it("sesión exigente con carga alta ayer (≥ 1,5× la media de 28 días) → descanso, con el motivo", () => {
    const r = recommendToday({ runs: [run(1, "series", 180), ...base], openInjury: false, now: NOW });
    expect(r.kind).toBe("descanso");
    expect(r.reason).toMatch(/carga 180, 1,8× tu media/);
  });

  it("rodaje con carga alta ayer → suave; rodaje normal ayer → libre", () => {
    expect(recommendToday({ runs: [run(1, "rodaje", 170), ...base], openInjury: false, now: NOW }).kind).toBe("suave");
    expect(recommendToday({ runs: [run(1, "rodaje", 95), ...base], openInjury: false, now: NOW }).kind).toBe("libre");
  });

  it("tres días seguidos corriendo → descanso", () => {
    const r = recommendToday({ runs: [run(1, "rodaje"), run(2, "rodaje"), run(3, "rodaje"), ...base], openInjury: false, now: NOW });
    expect(r.kind).toBe("descanso");
    expect(r.reason).toMatch(/tres días seguidos/);
  });

  it("dos días después de una sesión exigente → suave", () => {
    expect(recommendToday({ runs: [run(2, "series", 130), ...base], openInjury: false, now: NOW }).kind).toBe("suave");
  });

  it("descansado y sin calidad en 4 días → calidad", () => {
    const r = recommendToday({ runs: [run(2, "rodaje", 90), ...base], openInjury: false, now: NOW });
    expect(r.kind).toBe("calidad");
  });

  it("descansado pero con calidad reciente → libre", () => {
    const r = recommendToday({ runs: [run(3, "rodaje"), run(4, "tempo"), ...base], openInjury: false, now: NOW });
    expect(r.kind).toBe("libre");
  });

  it("parón largo → volver con suave", () => {
    const r = recommendToday({ runs: [run(14, "series", 150)], openInjury: false, now: NOW });
    expect(r.kind).toBe("suave");
    expect(r.reason).toMatch(/14 días sin correr/);
  });

  it("sin pulso (sin carga) no se inventa una comparación de carga", () => {
    const r = recommendToday({ runs: [run(1, "rodaje", null), ...base], openInjury: false, now: NOW });
    expect(r.kind).toBe("libre");
    expect(r.reason).not.toMatch(/carga/);
  });

  it("con pocas carreras de referencia (< 3 con carga) no hay «carga alta»", () => {
    const r = recommendToday({ runs: [run(1, "rodaje", 300), run(6, "rodaje", 50)], openInjury: false, now: NOW });
    expect(r.kind).toBe("libre");
  });
});

describe("recomendación de hoy con el ratio de carga", () => {
  const calidad = { runs: [run(2, "rodaje", 90), ...base], openInjury: false, now: NOW };
  const libre = { runs: [run(3, "rodaje"), run(4, "tempo"), ...base], openInjury: false, now: NOW };
  const fit = (ratio: number | null, enough = true, form = 0) => ({ ratio, form, chronic: 20, enough });

  it("ratio > 1,5 por sí solo → como mucho rodaje suave, con el motivo", () => {
    const r = recommendToday({ ...calidad, fitness: fit(1.62) });
    expect(r.kind).toBe("suave");
    expect(r.reason).toMatch(/Carga muy alta esta semana: ratio 1,62/);
    expect(recommendToday({ ...libre, fitness: fit(2.1) }).kind).toBe("suave");
  });
  it("ratio > 1,5 y dos días seguidos corriendo → descanso", () => {
    const seguidos = { runs: [run(1, "rodaje", 60), run(2, "rodaje", 60), ...base.slice(1)], openInjury: false, now: NOW };
    const r = recommendToday({ ...seguidos, fitness: fit(1.7) });
    expect(r.kind).toBe("descanso");
    expect(r.reason).toMatch(/dos días seguidos/);
    // con ratio normal, los mismos dos días no fuerzan descanso
    expect(recommendToday({ ...seguidos, fitness: fit(1.0) }).kind).not.toBe("descanso");
  });
  it("ratio 1,3–1,5 → como mucho suave", () => {
    const r = recommendToday({ ...calidad, fitness: fit(1.4) });
    expect(r).toMatchObject({ kind: "suave" });
    expect(r.reason).toMatch(/Carga alta esta semana: ratio 1,40/);
    expect(recommendToday({ ...libre, fitness: fit(1.3) }).kind).toBe("suave");
  });
  it("el ratio nunca hace la recomendación menos prudente", () => {
    const comp = { runs: [run(1, "competicion", 120), ...base], openInjury: false, now: NOW };
    expect(recommendToday({ ...comp, fitness: fit(0.5) }).kind).toBe("descanso");
    const r = recommendToday({ ...comp, fitness: fit(1.7) });
    expect(r.kind).toBe("descanso");
    expect(r.reason).toMatch(/ratio 1,70/);
  });
  it("calidad solo con ratio < 1,3, y lo dice", () => {
    const r = recommendToday({ ...calidad, fitness: fit(1.1) });
    expect(r.kind).toBe("calidad");
    expect(r.reason).toMatch(/ratio 1,10/);
  });
  it("libre y descansado: lo menciona", () => {
    expect(recommendToday({ ...libre, fitness: fit(0.6, true, 8) }).reason).toMatch(/Vienes descansado: ratio 0,60/);
  });
  it("sin 28 días de historial no usa el ratio y lo dice", () => {
    const r = recommendToday({ ...calidad, fitness: fit(1.8, false) });
    expect(r.kind).toBe("calidad");
    expect(r.reason).toMatch(/sin historial suficiente/);
  });
  it("con lesión abierta manda la lesión", () => {
    expect(recommendToday({ ...calidad, openInjury: true, fitness: fit(0.5) }).reason).toMatch(/lesión/);
  });
});

describe("tira de la semana", () => {
  it("lunes a domingo en hora de Madrid, con km, descanso, hoy y futuro", () => {
    const w = weekDays(
      [
        { startAt: new Date("2026-11-16T07:00:00Z"), distanceM: 8000 }, // lunes
        { startAt: new Date("2026-11-16T18:00:00Z"), distanceM: 2000 }, // lunes (otra)
        { startAt: new Date("2026-11-15T22:30:00Z"), distanceM: 5000 }, // domingo 23:30 Madrid → semana anterior
        { startAt: new Date("2026-11-15T23:30:00Z"), distanceM: 3000 }, // lunes 00:30 Madrid
      ],
      NOW,
    );
    expect(w.map((d) => d.letter)).toEqual(["L", "M", "X", "J", "V", "S", "D"]);
    expect(w[0]).toMatchObject({ date: "2026-11-16", km: 13, runs: 3, state: "corrido" });
    expect(w[1].state).toBe("descanso");
    expect(w[2]).toMatchObject({ state: "hoy", isToday: true });
    expect(w.slice(3).every((d) => d.state === "futuro")).toBe(true);
  });

  it("hoy ya corrido: «corrido» y marcado como hoy", () => {
    const w = weekDays([{ startAt: new Date("2026-11-18T07:00:00Z"), distanceM: 6000 }], NOW);
    expect(w[2]).toMatchObject({ state: "corrido", isToday: true, km: 6 });
  });
});
