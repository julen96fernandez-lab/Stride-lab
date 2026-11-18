import { describe, expect, it } from "vitest";
import { TARGETS, fmtRaceTime, pickSources, predictAt, predictTarget, predictionHistory, riegel, type EffortIn } from "@/lib/plan/predict";

const NOW = Date.UTC(2026, 10, 18, 12);
const ago = (days: number) => NOW - days * 86_400_000;
const T = (k: string) => TARGETS.find((t) => t.key === k)!;
const e = (key: string, timeS: number, daysAgo: number): EffortIn => ({ key, timeS, at: ago(daysAgo) });

describe("Riegel", () => {
  it("T = t·(D/d)^1,06", () => {
    expect(riegel(1200, 5000, 10000, 1.06)).toBeCloseTo(1200 * 2 ** 1.06);
    expect(riegel(2500, 10000, 5000, 1.06)).toBeLessThan(1250); // hacia abajo, algo más rápido que la mitad
  });
  it("formato de tiempos", () => {
    expect(fmtRaceTime(1334)).toBe("22:14");
    expect(fmtRaceTime(6021)).toBe("1:40:21");
  });
});

describe("fuentes", () => {
  it("el mejor de la ventana más reciente (3, 6 y 12 meses)", () => {
    const s = pickSources([e("5k", 1300, 200), e("5k", 1350, 30), e("5k", 1340, 60), e("10k", 2750, 150), e("half", 6000, 400)], NOW);
    expect(s.find((x) => x.key === "5k")).toMatchObject({ timeS: 1340, window: 91 }); // no el de hace 200 días, aunque sea mejor
    expect(s.find((x) => x.key === "10k")).toMatchObject({ window: 182 });
    expect(s.find((x) => x.key === "half")).toBeUndefined(); // más de 12 meses
  });
  it("los esfuerzos de 1 km no cuentan (las series lo inflarían)", () => {
    expect(pickSources([e("1k", 200, 5)], NOW)).toEqual([]);
  });
});

describe("predicción", () => {
  const src = pickSources([e("5k", 1334, 20), e("10k", 2755, 40), e("half", 6021, 32), e("1mi", 418, 10)], NOW);
  it("10K: central entre las estimaciones de sus fuentes, con rango que la contiene", () => {
    const p = predictTarget(T("10k"), src, 21000)!;
    const est = p.sources.map((s) => s.estimateS);
    expect(p.timeS).toBeGreaterThanOrEqual(Math.min(...est) - 1e-6);
    expect(p.timeS).toBeLessThanOrEqual(Math.max(...est) + 1e-6);
    expect(p.lowS).toBeLessThanOrEqual(p.timeS);
    expect(p.highS).toBeGreaterThanOrEqual(p.timeS);
    expect(p.confidence).toBe("alta");
    expect(p.sources[0].key).toBe("10k"); // la misma distancia pesa más
  });
  it("la milla solo sirve para el 5K (no se extrapola más de ×4,3)", () => {
    expect(predictTarget(T("5k"), src, 21000)!.sources.map((s) => s.key)).toContain("1mi");
    expect(predictTarget(T("10k"), src, 21000)!.sources.map((s) => s.key)).not.toContain("1mi");
  });
  it("maratón oculto sin tirada de 30 km en 12 meses; con ella, se muestra", () => {
    expect(predictTarget(T("marathon"), src, 22000)).toBeNull();
    const m = predictTarget(T("marathon"), src, 30000)!;
    expect(m.sources.map((s) => s.key)).toEqual(["half", "10k"]); // 5K está a ×8,4: fuera
  });
  it("sin datos suficientes, la distancia no se muestra", () => {
    expect(predictAt([e("1mi", 420, 10)], [], NOW).map((p) => p.key)).toEqual(["5k"]);
    expect(predictAt([], [], NOW)).toEqual([]);
  });
  it("confianza: alta / media / baja", () => {
    expect(predictTarget(T("half"), pickSources([e("10k", 2755, 10), e("half", 6021, 20)], NOW), 0)!.confidence).toBe("alta");
    expect(predictTarget(T("half"), pickSources([e("10k", 2755, 120)], NOW), 0)!.confidence).toBe("media");
    expect(predictTarget(T("half"), pickSources([e("10k", 2755, 300)], NOW), 0)!.confidence).toBe("baja");
    expect(predictTarget(T("half"), pickSources([e("5k", 1334, 10), e("1mi", 418, 10)], NOW), 0)!.confidence).toBe("baja"); // solo a ×4,2
    // media desde 5K y 10K recientes, pero sin ningún esfuerzo de distancia parecida: no es «alta»
    expect(predictTarget(T("half"), pickSources([e("5k", 1334, 10), e("10k", 2755, 10)], NOW), 0)!.confidence).toBe("media");
  });
  it("lo más antiguo pesa menos", () => {
    const p = predictTarget(T("10k"), pickSources([e("5k", 1200, 10), e("half", 6400, 300)], NOW), 0)!;
    const w = Object.fromEntries(p.sources.map((s) => [s.key, s.weight]));
    expect(w["5k"]).toBeGreaterThan(w.half);
  });
});

describe("evolución por meses con los datos de cada momento", () => {
  it("un mes solo usa lo que había a final de ese mes", () => {
    const efforts = [e("10k", 3000, 100), e("10k", 2700, 10)];
    const h = predictionHistory(efforts, [], NOW, 6);
    const tenk = h["10k"];
    expect(tenk.at(-1)!.month).toBe("2026-11");
    expect(tenk.at(-1)!.timeS).toBeLessThan(2800); // ya incluye el de hace 10 días
    const aug = tenk.find((p) => p.month === "2026-08")!;
    expect(aug.timeS).toBeGreaterThan(2900); // en agosto solo existía el de 3000 s
    expect(tenk.some((p) => p.month === "2026-06")).toBe(false); // antes del primer dato: sin predicción
  });
  it("cambio de año en la serie de meses", () => {
    const h = predictionHistory([e("5k", 1300, 400), e("5k", 1300, 5)], [], NOW, 13);
    expect(h["5k"].map((p) => p.month)).toContain("2026-01");
    expect(h["5k"].map((p) => p.month)).toContain("2025-12");
  });
});
