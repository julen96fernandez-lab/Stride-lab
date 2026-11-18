import { describe, expect, it } from "vitest";
import { countdownText, daysUntil, fmtTime, parseRaceForm, parseTime, raceProfile, realism } from "@/lib/race/race";
import { predictDistance, pickSources } from "@/lib/plan/predict";

describe("formulario de carrera objetivo", () => {
  const f = (o: Record<string, string> = {}) => ({ name: "Media de Bilbao", date: "2027-03-14", distanceKey: "half", target: "1:39:00", ...o });
  it("válido con lo mínimo; distancias fijas y «otra» en km", () => {
    expect(parseRaceForm(f(), "2026-11-18").input).toMatchObject({ name: "Media de Bilbao", distanceM: 21097.5, targetS: 5940, startTime: null });
    expect(parseRaceForm(f({ distanceKey: "other", distanceKm: "15,5", target: "1:12:00" }), "2026-11-18").input).toMatchObject({ distanceM: 15500 });
    expect(parseRaceForm(f({ startTime: "09:30" }), "2026-11-18").input!.startTime).toBe("09:30");
  });
  it("errores claros", () => {
    const e = (o: Record<string, string>) => parseRaceForm(f(o), "2026-11-18").errors;
    expect(e({ name: " " }).name).toMatch(/nombre/);
    expect(e({ date: "2027-02-30" }).date).toBeTruthy();
    expect(e({ distanceKey: "other", distanceKm: "0" }).distance).toBeTruthy();
    expect(e({ startTime: "25:00" }).startTime).toBeTruthy();
    expect(e({ target: "abc" }).target).toBeTruthy();
    expect(e({ target: "0:30:00" }).target).toMatch(/imposible/); // media en 30 min
  });
  it("tiempos", () => {
    expect(parseTime("1:39:00")).toBe(5940);
    expect(parseTime("45:30")).toBe(2730);
    expect(parseTime("1:60:00")).toBeNull();
    expect(fmtTime(5940)).toBe("1:39:00");
    expect(fmtTime(1335)).toBe("22:15");
  });
});

describe("etiqueta de realismo", () => {
  const range = { lowS: 6000, highS: 6500 };
  it("realista dentro del rango; ambicioso más rápido; muy ambicioso > 3 %; conservador más lento", () => {
    expect(realism(6000, range)).toBe("realista");
    expect(realism(6500, range)).toBe("realista");
    expect(realism(5999, range)).toBe("ambicioso");
    expect(realism(6000 * 0.97, range)).toBe("ambicioso"); // justo un 3 %
    expect(realism(6000 * 0.97 - 1, range)).toBe("muy_ambicioso");
    expect(realism(6501, range)).toBe("conservador");
    expect(realism(6000, null)).toBeNull(); // sin predicción
  });
  it("con las predicciones de verdad (distancia «otra»)", () => {
    const now = Date.UTC(2026, 10, 18);
    const src = pickSources([{ key: "10k", timeS: 2755, at: now - 30 * 86_400_000 }, { key: "half", timeS: 6021, at: now - 30 * 86_400_000 }], now);
    const p = predictDistance(15000, src, 22000)!;
    expect(p.timeS).toBeGreaterThan(2755 * 1.4);
    expect(realism(p.timeS, p)).toBe("realista");
    expect(predictDistance(42195, src, 22000)).toBeNull(); // maratón sin tirada de 30 km
  });
});

describe("cuenta atrás", () => {
  it("días y texto", () => {
    expect(daysUntil("2026-11-20", "2026-11-18")).toBe(2);
    expect(daysUntil("2027-01-02", "2026-12-31")).toBe(2); // cambio de año
    expect(daysUntil("2027-03-28", "2027-03-27")).toBe(1); // cambio de hora
    expect(countdownText(0)).toBe("¡Es hoy!");
    expect(countdownText(1)).toBe("Mañana");
    expect(countdownText(5)).toBe("Faltan 5 días");
    expect(countdownText(23)).toBe("Faltan 3 semanas y 2 días (23 días)");
    expect(countdownText(-1)).toBe("Fue ayer");
  });
});

describe("perfil del GPX", () => {
  // recta de ~2,1 km hacia el norte que sube 20 m y baja 10
  const pts = Array.from({ length: 211 }, (_, i) => ({ lat: 43 + (i * 10) / 111_195, lon: -3, ele: i <= 100 ? 20 + i * 0.2 : 40 - (i - 100) * 0.1, time: null }));
  it("se escala a la distancia oficial y avisa de la diferencia", () => {
    const p = raceProfile(pts, 2000)!;
    expect(p.gpxM).toBeGreaterThan(2090);
    expect(p.scale).toBeCloseTo(2000 / p.gpxM, 6);
    expect(p.d.at(-1)).toBeCloseTo(2000, 0);
    expect(p.e[0]).toBe(20);
    expect(p.gainM).toBe(20);
  });
  it("sin altitud no hay perfil", () => {
    expect(raceProfile(pts.map((x) => ({ ...x, ele: null })), 2000)).toBeNull();
  });
});
