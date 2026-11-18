import { describe, expect, it } from "vitest";
import { analyzeIntervals, parseKey, type StepTiming } from "@/lib/analysis/intervals";
import { decouplingEligible, decouplingLabel, paceInHrBand, paceVariation, z2Band } from "@/lib/analysis/efficiency";
import { DEFAULT_ZONES } from "@/lib/analysis/hr-zones";

/** Muestras de distancia cada 3 s según una función de velocidad, y pulso cada 5 s. */
function streams(total: number, speed: (t: number) => number, hrAt: (t: number) => number) {
  const dt: number[] = [];
  const dv: number[] = [];
  for (let t = 3; t <= total; t += 3) {
    dt.push(t);
    dv.push(speed(t - 1.5) * 3);
  }
  const ht: number[] = [];
  const hv: number[] = [];
  for (let t = 0; t <= total; t += 5) {
    ht.push(t);
    hv.push(hrAt(t));
  }
  return { distance: { t: dt, v: dv }, hr: { t: ht, v: hv } };
}

// Calentamiento 600 s, 4 × (120 s trabajo + 90 s recuperación), enfriamiento 300 s.
const steps: StepTiming[] = [{ key: "0.0.0", startS: 0, durationS: 600 }];
for (let k = 0; k < 4; k++) {
  const s = 600 + k * 210;
  steps.push({ key: `1.${k}.0`, startS: s, durationS: 120 }, { key: `1.${k}.1`, startS: s + 120, durationS: 90 });
}
steps.push({ key: "2.0.0", startS: 1440, durationS: 300 });

// Trabajo a 4,4 → 4,0 m/s (se va cansando), recuperación a 2 m/s, resto a 2,8 m/s.
const speedAt = (t: number) => {
  const st = steps.find((s) => t >= s.startS && t < s.startS + s.durationS);
  const p = st ? parseKey(st.key)! : null;
  if (p && p.block === 1 && p.phase === 0) return 4.4 - p.rep * 0.133;
  if (p && p.block === 1 && p.phase === 1) return 2;
  return 2.8;
};
// Pulso: sube a 170 al final de cada repetición y baja a 130 al final de la recuperación.
const hrAt = (t: number) => {
  const st = steps.find((s) => t >= s.startS && t <= s.startS + s.durationS);
  const p = st ? parseKey(st.key)! : null;
  if (p && p.block === 1 && p.phase === 0) return 140 + (30 * (t - st!.startS)) / 120;
  if (p && p.block === 1 && p.phase === 1) return 170 - (40 * (t - st!.startS)) / 90;
  return 135;
};
const { distance, hr } = streams(1740, speedAt, hrAt);

describe("series: trabajo y recuperación", () => {
  const a = analyzeIntervals(steps, distance, hr);

  it("clasifica calentamiento, 4 repeticiones con sus recuperaciones y enfriamiento", () => {
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.rows.map((r) => r.kind)).toEqual([
      "calentamiento",
      "trabajo",
      "recuperacion",
      "trabajo",
      "recuperacion",
      "trabajo",
      "recuperacion",
      "trabajo",
      "recuperacion",
      "enfriamiento",
    ]);
    expect(a.rows.filter((r) => r.kind === "trabajo").map((r) => r.rep)).toEqual([1, 2, 3, 4]);
    expect(a.summary.reps).toBe(4);
  });

  it("distancia, tiempo y ritmo de cada repetición", () => {
    if (!a.ok) return;
    const w = a.rows.filter((r) => r.kind === "trabajo");
    expect(w[0].distanceM).toBeCloseTo(4.4 * 120, 0);
    expect(w[0].paceSPerKm).toBeCloseTo(1000 / 4.4, 0);
    expect(w[3].paceSPerKm).toBeCloseTo(1000 / (4.4 - 3 * 0.133), 0);
    expect(a.summary.workTimeS).toBe(480);
  });

  it("caída de ritmo de la primera a la última repetición (%)", () => {
    if (!a.ok) return;
    const expected = ((1000 / (4.4 - 0.399) - 1000 / 4.4) / (1000 / 4.4)) * 100;
    expect(a.summary.paceDropPct).toBeCloseTo(expected, 0);
    expect(a.summary.paceDropPct!).toBeGreaterThan(0); // más lenta al final
  });

  it("pulso medio y máximo, y bajada de pulso en cada recuperación", () => {
    if (!a.ok) return;
    const w = a.rows.find((r) => r.kind === "trabajo")!;
    expect(w.maxHr).toBeCloseTo(170, 0);
    expect(w.avgHr).toBeCloseTo(155, 0);
    const r = a.rows.filter((x) => x.kind === "recuperacion");
    for (const x of r) expect(x.hrDrop).toBeCloseTo(40, 0); // 170 → 130
    expect(a.summary.avgHrDrop).toBeCloseTo(40, 0);
  });

  it("sin pulso: ritmos sí, pulso y recuperación de pulso vacíos", () => {
    const b = analyzeIntervals(steps, distance, null);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.rows.every((r) => r.avgHr === null && r.hrDrop === null)).toBe(true);
    expect(b.summary.avgHrDrop).toBeNull();
  });
});

describe("series: cuándo no se puede separar (sin inventar)", () => {
  it("sin horas de los pasos (importación antigua): explica que hay que reprocesar", () => {
    const a = analyzeIntervals([], distance, hr);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/Reprocesar/);
  });

  it("si la «recuperación» es más rápida que el «trabajo», no se separa", () => {
    const fake = steps.map((s) => {
      const p = parseKey(s.key)!;
      return p.block === 1 ? { ...s, key: `1.${p.rep}.${1 - p.phase}` } : s;
    });
    const a = analyzeIntervals(fake, distance, hr);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/no permiten distinguir/);
  });

  it("sin bloques con repeticiones, una sola repetición o claves raras", () => {
    expect(analyzeIntervals([{ key: "0.0.0", startS: 0, durationS: 600 }], distance, hr).ok).toBe(false);
    expect(
      analyzeIntervals(
        [
          { key: "1.0.0", startS: 0, durationS: 120 },
          { key: "1.0.1", startS: 120, durationS: 90 },
        ],
        distance,
        hr,
      ).ok,
    ).toBe(false);
    expect(analyzeIntervals([{ key: "trabajo", startS: 0, durationS: 1 }], distance, hr).ok).toBe(false);
  });

  it("sin muestras de distancia no hay ritmos", () => {
    const a = analyzeIntervals(steps, null, hr);
    expect(a.ok).toBe(false);
  });
});

describe("desacople aeróbico: solo con ritmo estable", () => {
  const km = (p: number) => ({ distanceM: 1000, paceSPerKm: p });
  const stable = [km(300), km(302), km(298), km(305), km(301), { distanceM: 400, paceSPerKm: 250 }];

  it("variación del ritmo de los parciales completos", () => {
    const v = paceVariation(stable)!;
    expect(v.n).toBe(5); // el parcial incompleto no cuenta
    expect(v.cv).toBeLessThan(0.01);
  });

  it("Rodaje o Tirada larga, con pulso, ≥ 4 km y estable: sí", () => {
    expect(decouplingEligible({ type: "rodaje", hasHr: true, splits: stable }).ok).toBe(true);
    expect(decouplingEligible({ type: "tirada_larga", hasHr: true, splits: stable }).ok).toBe(true);
  });

  it("otros tipos, sin pulso, pocos km o ritmo variable: no", () => {
    expect(decouplingEligible({ type: "series", hasHr: true, splits: stable }).ok).toBe(false);
    expect(decouplingEligible({ type: "rodaje", hasHr: false, splits: stable }).ok).toBe(false);
    expect(decouplingEligible({ type: "rodaje", hasHr: true, splits: stable.slice(0, 3) }).ok).toBe(false);
    const fartlek = [km(250), km(330), km(260), km(340), km(255)];
    const r = decouplingEligible({ type: "rodaje", hasHr: true, splits: fartlek });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/poco estable/);
  });

  it("lectura del %", () => {
    expect(decouplingLabel(3)).toMatch(/Bajo/);
    expect(decouplingLabel(7)).toMatch(/Moderado/);
    expect(decouplingLabel(12)).toMatch(/Alto/);
    expect(decouplingLabel(-2)).toMatch(/Sin desacople/);
  });
});

describe("eficiencia: ritmo en Z2", () => {
  it("Z2 con tus zonas 47/187 = 131–144 ppm", () => {
    expect(z2Band(DEFAULT_ZONES.limits)).toEqual([131, 144]);
  });

  it("ritmo medio por distancia de los instantes en Z2; necesita ≥ 5 min", () => {
    // 120 instantes de 3 s (6 min): 60 en Z2 a 5:00 y 60 a 6:00 en Z2; otros fuera.
    const pace = [...Array(60).fill(300), ...Array(60).fill(360), ...Array(40).fill(250)];
    const hr = [...Array(120).fill(138), ...Array(40).fill(160)];
    const r = paceInHrBand(pace, hr, 3, [131, 144])!;
    expect(r.seconds).toBe(360);
    // velocidad media (1000/300 + 1000/360)/2 → ritmo ≈ 327 s/km (no la media de ritmos, 330)
    expect(r.paceSPerKm).toBeCloseTo(1000 / ((1000 / 300 + 1000 / 360) / 2), 6);
    expect(paceInHrBand(pace.slice(0, 50), hr.slice(0, 50), 3, [131, 144])).toBeNull(); // 2,5 min
  });

  it("instantes sin ritmo (pausas, inválidos) o sin pulso no cuentan", () => {
    const pace = [...Array(100).fill(null), ...Array(110).fill(320)];
    const hr = [...Array(210).fill(140)];
    expect(paceInHrBand(pace, hr, 3, [131, 144])!.seconds).toBe(330);
    expect(paceInHrBand(pace, null, 3, [131, 144])).toBeNull();
  });
});
