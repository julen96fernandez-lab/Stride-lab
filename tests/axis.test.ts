import { describe, expect, it } from "vitest";
import { regularAxis, TIME_STEPS } from "@/lib/analysis/axis";

const ticks = (a: { min: number; max: number; interval: number }) => {
  const out: number[] = [];
  for (let v = a.min; v <= a.max + 1e-9; v += a.interval) out.push(v);
  return out;
};

describe("ejes de ritmo regulares", () => {
  it("rango ajustado a los datos y marcas cada 15 s", () => {
    const a = regularAxis([286, 300, 312], 4);
    expect(a.interval).toBe(15);
    expect(a.min).toBeLessThanOrEqual(286);
    expect(a.min).toBeGreaterThan(286 - 2 * 15); // ajustado: a menos de dos pasos del mínimo
    expect(a.max).toBeGreaterThanOrEqual(312);
    expect(a.max).toBeLessThan(312 + 2 * 15);
    expect(a.min % 15).toBe(0);
    expect(ticks(a).length).toBeLessThanOrEqual(5);
  });

  it("rango amplio: marcas cada 30 s, siempre a la misma distancia", () => {
    const a = regularAxis([270, 330, 380], 5);
    expect(a.interval).toBe(30);
    const t = ticks(a);
    expect(new Set(t.slice(1).map((v, i) => v - t[i])).size).toBe(1);
  });

  it("un solo valor: un tramo de un paso, sin marcas irregulares (4:30, 5:00, 5:30, 5:45)", () => {
    const a = regularAxis([286], 2);
    expect(a.max - a.min).toBeGreaterThanOrEqual(15);
    expect(ticks(a).length).toBeLessThanOrEqual(3);
  });

  it("tramos máximos respetados (gráfico pequeño)", () => {
    const a = regularAxis([250, 330], 2);
    expect((a.max - a.min) / a.interval).toBeLessThanOrEqual(2);
    expect([15, 30, 60]).toContain(a.interval);
  });

  it("tiempos de esfuerzo: pasos de minutos, nunca decimales raros", () => {
    const a = regularAxis([5640, 6021], 4, TIME_STEPS);
    expect(a.min % a.interval).toBe(0);
    expect(a.max % a.interval).toBe(0);
    expect(a.interval).toBeGreaterThanOrEqual(60);
  });

  it("sin datos: valores por defecto", () => {
    expect(regularAxis([])).toEqual({ min: 240, max: 420, interval: 30 });
  });
});
