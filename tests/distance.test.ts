import { describe, expect, it } from "vitest";
import { chooseDistance, type DistanceStat } from "@/lib/import/distance";

const T0 = Date.parse("2026-04-03T15:29:27Z");
const min = (m: number) => T0 + m * 60_000;
const act = (a: number, b: number, km: number): DistanceStat => ({ level: "activity", startMs: min(a), endMs: min(b), meters: km * 1000 });
const wk = (a: number, b: number, km: number): DistanceStat => ({ level: "workout", startMs: min(a), endMs: min(b), meters: km * 1000 });

describe("elegir distancia sin duplicar", () => {
  it("un solo bloque repetido a nivel de entrenamiento: no se suma (17-oct)", () => {
    expect(chooseDistance([act(0, 101.7, 21.34), wk(0, 101.7, 21.34)], min(0), min(101.7))).toEqual({ meters: 21_340, source: "workout" });
    expect(chooseDistance([act(0, 101.7, 21.34)], min(0), min(101.7))).toEqual({ meters: 21_340, source: "activities" });
  });
  it("bloques que cubren la sesión sin total: se suman", () => {
    expect(chooseDistance([act(0, 10, 2), act(10, 40, 6), act(40, 50, 1.5)], min(0), min(50))).toEqual({ meters: 9500, source: "activities" });
  });
  it("total a nivel de entrenamiento + bloques: solo el total", () => {
    expect(chooseDistance([act(0, 10, 2), act(10, 50, 7), wk(0, 50, 9)], min(0), min(50)).meters).toBe(9000);
  });
  it("bloques solapados: no se suman, queda pendiente de las muestras", () => {
    expect(chooseDistance([act(0, 30, 5), act(20, 50, 6)], min(0), min(50)).source).toBe("samples_pending");
  });

  // Sesiones de series de referencia: solo el calentamiento trae distancia → muestras del reloj.
  it.each([
    ["04-03", 50.3, 10.1, 1.92],
    ["05-13", 53.0, 18.3, 3.16],
    ["06-28", 50.0, 10.7, 2.01],
    ["07-30", 46.4, 11.2, 2.0],
    ["08-30", 20.0, 6.2, 1.0],
    ["09-04", 47.5, 6.3, 1.0],
    ["09-11", 72.0, 6.2, 1.01],
    ["09-29", 32.4, 5.8, 1.01],
    ["10-06", 34.3, 10.3, 1.94],
  ])("%s: el calentamiento no es la distancia de la sesión", (_d, dur, warm, km) => {
    expect(chooseDistance([act(0, warm, km)], min(0), min(dur)).source).toBe("samples_pending");
  });
});
