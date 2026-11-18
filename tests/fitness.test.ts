import { describe, expect, it } from "vitest";
import {
  CHRONIC_ALPHA,
  dailyLoads,
  fitnessSeries,
  loadCounts,
  loadState,
  MIN_CHRONIC,
  weeklyLoads,
  type DayLoad,
  type LoadRun,
} from "@/lib/analysis/fitness";
import { runLoad, DEFAULT_ZONES } from "@/lib/analysis/hr-zones";
import { localDay } from "@/lib/analysis/periods";

const L = DEFAULT_ZONES.limits; // 117,131,145,159,173
const at = (ymd: string, h = 10) => new Date(`${ymd}T${String(h).padStart(2, "0")}:00:00Z`);
const run = (id: string, ymd: string, load: number | null, estimated = false): LoadRun => ({ id, startAt: at(ymd), load, estimated });
const days = (loads: number[], start = 20000): DayLoad[] =>
  loads.map((load, i) => ({ day: start + i, date: "", load, runs: [], estimated: false, missing: 0 }));

describe("runLoad (carga por carrera)", () => {
  it("medida si el pulso cubre al menos el 80 %", () => {
    const r = runLoad({ zoneSeconds: [0, 2400, 600, 0, 0], durationS: 3600, avgHr: 140, limits: L });
    expect(r).toEqual({ load: 40 * 2 + 10 * 3, quality: "measured", coverage: 3000 / 3600 });
  });
  it("estimada con el pulso medio si cubre menos (toda la duración en su zona)", () => {
    // 4 jul: 136 min, pulso en 1431 s (18 %), pulso medio 144 → Z2 → 136 × 2
    const r = runLoad({ zoneSeconds: [965, 306, 160, 0, 0], durationS: 8152.981, avgHr: 144.231, limits: L });
    expect(r.quality).toBe("estimated");
    expect(r.load).toBe(Math.round((8152.981 / 60) * 2));
    expect(r.coverage).toBeLessThan(0.2);
  });
  it("sin pulso medio, la media de las muestras (si hay ≥ 5)", () => {
    expect(runLoad({ zoneSeconds: [0, 60, 0, 0, 0], durationS: 3000, avgHr: null, hrSamples: [150, 150, 150, 150, 150], limits: L })).toMatchObject({
      load: 150,
      quality: "estimated",
    });
    expect(runLoad({ zoneSeconds: [0, 20, 0, 0, 0], durationS: 3000, avgHr: null, hrSamples: [150, 150], limits: L })).toMatchObject({
      load: null,
      quality: null,
    });
  });
  it("sin pulso: sin dato (no se inventa)", () => {
    expect(runLoad({ zoneSeconds: null, durationS: 3000, avgHr: null, limits: L })).toEqual({ load: null, quality: null, coverage: 0 });
  });
  it("justo en el 80 % ya es medida", () => {
    expect(runLoad({ zoneSeconds: [0, 2400, 0, 0, 0], durationS: 3000, avgHr: 140, limits: L }).quality).toBe("measured");
    expect(runLoad({ zoneSeconds: [0, 2399, 0, 0, 0], durationS: 3000, avgHr: 140, limits: L }).quality).toBe("estimated");
  });
});

describe("loadState (tramos del ratio)", () => {
  it("límites 0,8 · 1,3 · 1,5", () => {
    expect(loadState(0.79)).toBe("descansado");
    expect(loadState(0.8)).toBe("en_forma");
    expect(loadState(1.29)).toBe("en_forma");
    expect(loadState(1.3)).toBe("cargado");
    expect(loadState(1.5)).toBe("cargado");
    expect(loadState(1.51)).toBe("sobrecargado");
    expect(loadState(null)).toBeNull();
  });
});

describe("dailyLoads", () => {
  it("suma por día (hora de Madrid), días sin correr = 0, y marca estimadas y sin dato", () => {
    const d = dailyLoads(
      [run("a", "2026-03-01", 50), run("b", "2026-03-01", 30, true), run("c", "2026-03-03", null), run("d", "2026-03-04", 20)],
      localDay(at("2026-03-05")),
    );
    expect(d.map((x) => x.load)).toEqual([80, 0, 0, 20, 0]);
    expect(d[0]).toMatchObject({ date: "2026-03-01", runs: ["a", "b"], estimated: true, missing: 0 });
    expect(d[2]).toMatchObject({ load: 0, missing: 1 });
  });
  it("las 23:30 en Madrid cuentan en su día aunque en UTC sea otro", () => {
    const d = dailyLoads([{ id: "x", startAt: new Date("2026-06-30T22:30:00Z"), load: 10, estimated: false }], localDay(at("2026-07-01")));
    expect(d).toHaveLength(1);
    expect(d[0].date).toBe("2026-07-01");
  });
  it("sin carreras: vacío", () => {
    expect(dailyLoads([], 20000)).toEqual([]);
  });
});

describe("fitnessSeries (aguda, crónica, forma, ratio)", () => {
  it("aguda = media simple de 7 días", () => {
    const s = fitnessSeries(days([70, 0, 0, 0, 0, 0, 0, 0]));
    expect(s[0].acute).toBeCloseTo(10);
    expect(s[6].acute).toBeCloseTo(10);
    expect(s[7].acute).toBeCloseTo(0); // la carga del día 0 sale de la ventana
  });
  it("crónica = media exponencial de 28 días (α = 1 − e^(−1/28))", () => {
    const s = fitnessSeries(days([100, 0, 0]));
    expect(s[0].chronic).toBeCloseTo(100 * CHRONIC_ALPHA);
    expect(s[2].chronic).toBeCloseTo(100 * CHRONIC_ALPHA * (1 - CHRONIC_ALPHA) ** 2);
  });
  it("carga constante: crónica tiende a la carga diaria y la forma a 0, ratio ≈ 1 (En forma)", () => {
    const s = fitnessSeries(days(Array(400).fill(50)));
    const last = s.at(-1)!;
    expect(last.chronic).toBeCloseTo(50, 3);
    expect(last.acute).toBeCloseTo(50);
    expect(last.form).toBeCloseTo(0, 3);
    expect(last.ratio).toBeCloseTo(1, 3);
    expect(last.state).toBe("en_forma");
  });
  it("forma = crónica − aguda; una semana fuerte la hace negativa y sube el ratio", () => {
    const s = fitnessSeries(days([...Array(200).fill(30), ...Array(7).fill(60)]));
    const last = s.at(-1)!;
    expect(last.form).toBeCloseTo(last.chronic - last.acute);
    expect(last.form).toBeLessThan(0);
    expect(last.ratio!).toBeGreaterThan(1.5);
    expect(last.state).toBe("sobrecargado");
  });
  it("descanso tras carga constante: ratio bajo (Descansado) y forma positiva", () => {
    const last = fitnessSeries(days([...Array(200).fill(40), ...Array(7).fill(0)])).at(-1)!;
    expect(last.ratio).toBe(0);
    expect(last.state).toBe("descansado");
    expect(last.form).toBeGreaterThan(0);
  });
  it("sin ratio si la crónica es casi 0", () => {
    const s = fitnessSeries(days([10, 0, 0]));
    expect(s[0].chronic).toBeLessThan(MIN_CHRONIC);
    expect(s[0].ratio).toBeNull();
    expect(s[0].state).toBeNull();
  });
  it("menos de 28 días de historial: en calentamiento y estimado", () => {
    const s = fitnessSeries(days(Array(30).fill(20)));
    expect(s[26]).toMatchObject({ warmup: true, approx: true });
    expect(s[27]).toMatchObject({ warmup: false, approx: false });
  });
  it("una carga estimada o sin dato marca ≈ los 28 días siguientes", () => {
    const d = days(Array(70).fill(20));
    d[30] = { ...d[30], estimated: true };
    d[40] = { ...d[40], missing: 1 };
    const s = fitnessSeries(d);
    expect(s[29].approx).toBe(false);
    expect(s[30].approx).toBe(true);
    expect(s[67].approx).toBe(true); // 40 + 27
    expect(s[68].approx).toBe(false);
  });
});

describe("weeklyLoads (carga semanal y subida > 30 %)", () => {
  // 2026-03-02 es lunes
  const mon = localDay(at("2026-03-02"));
  const byWeek = (weeks: number[][]) => {
    const flat = weeks.flat();
    return days(flat, mon);
  };
  it("suma de lunes a domingo y aviso si sube más de un 30 % sobre la anterior", () => {
    const w = weeklyLoads(byWeek([[100, 0, 0, 0, 0, 0, 0], [100, 0, 0, 30, 0, 0, 0], [100, 0, 0, 0, 0, 0, 30]]), mon + 20);
    expect(w.map((x) => x.load)).toEqual([100, 130, 130]);
    expect(w[0]).toMatchObject({ start: "2026-03-02", prevLoad: null, alert: false });
    expect(w[1].rise).toBeCloseTo(0.3);
    expect(w[1].alert).toBe(false); // justo un 30 %: sin aviso
    expect(w[2].alert).toBe(false);
  });
  it("avisa con más del 30 % solo si además supera la media de las 8 semanas previas", () => {
    // 8 semanas de 100, una floja de 40 y luego 120: +200 % y por encima de la media (≈ 92,5) → aviso
    const flat = (l: number) => [l, 0, 0, 0, 0, 0, 0];
    const w = weeklyLoads(byWeek([...Array(8).fill(flat(100)), flat(40), flat(120)]), mon + 69);
    expect(w[9].avg8).toBeCloseTo((7 * 100 + 40) / 8);
    expect(w[9].alert).toBe(true);
    // tras la semana floja, volver a 80: +100 % pero por debajo de la media → sin aviso
    const w2 = weeklyLoads(byWeek([...Array(8).fill(flat(100)), flat(40), flat(80)]), mon + 69);
    expect(w2[9].rise).toBeCloseTo(1);
    expect(w2[9].alert).toBe(false);
  });
  it("sin 8 semanas previas no hay media y no se avisa", () => {
    const w = weeklyLoads(byWeek([[100, 0, 0, 0, 0, 0, 0], [200, 0, 0, 0, 0, 0, 0]]), mon + 13);
    expect(w[1].rise).toBeCloseTo(1);
    expect(w[1].alert).toBe(false);
  });
  it("semana en curso: compara con los mismos días de la anterior", () => {
    // semana pasada: 50 el lunes y 200 el sábado; esta: 60 el lunes, hoy miércoles
    const w = weeklyLoads(byWeek([[50, 0, 0, 0, 0, 200, 0], [60, 0, 0]]), mon + 9);
    const cur = w.at(-1)!;
    expect(cur.partial).toBe(true);
    expect(cur.prevLoad).toBe(50);
    expect(cur.rise).toBeCloseTo(0.2);
    expect(cur.alert).toBe(false);
  });
  it("tras una semana sin carga no hay porcentaje (no se divide entre 0)", () => {
    const w = weeklyLoads(byWeek([[10, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [80, 0, 0, 0, 0, 0, 0]]), mon + 20);
    expect(w[2]).toMatchObject({ rise: null, alert: false });
  });
  it("media de las 8 semanas anteriores (null si hay menos)", () => {
    const weeks = Array.from({ length: 9 }, (_, i) => [10 * (i + 1), 0, 0, 0, 0, 0, 0]);
    const w = weeklyLoads(byWeek(weeks), mon + 62);
    expect(w[7].avg8).toBeNull();
    expect(w[8].avg8).toBeCloseTo((10 + 20 + 30 + 40 + 50 + 60 + 70 + 80) / 8);
  });
});

describe("loadCounts", () => {
  it("cuenta medidas, estimadas y sin dato", () => {
    expect(loadCounts([run("a", "2026-01-01", 10), run("b", "2026-01-02", 10, true), run("c", "2026-01-03", null)])).toEqual({
      measured: 1,
      estimated: 1,
      missing: 1,
    });
  });
});

describe("vista en columnas (lo que viaja al móvil)", () => {
  it("ida y vuelta: mismos valores (redondeados a 2 decimales), forma y estado recalculados", async () => {
    const { buildFitnessView, viewPoints } = await import("@/lib/analysis/fitness");
    const runs = Array.from({ length: 60 }, (_, i) => ({
      id: `r${i}`,
      startAt: new Date(Date.UTC(2026, 8, 1 + i * 2, 8)),
      load: i % 5 === 0 ? null : 40 + (i % 7) * 10,
      estimated: i % 3 === 0,
      distanceM: 10000,
      type: "rodaje",
    }));
    const v = buildFitnessView(runs, new Date("2026-11-18T12:00:00Z"), false);
    const pts = viewPoints(v.cols);
    expect(pts).toHaveLength(v.cols.date.length);
    const full = fitnessSeries(dailyLoads(runs, localDay(new Date("2026-11-18T12:00:00Z"))));
    const last = full.at(-1)!;
    const lp = pts.at(-1)!;
    expect(lp.chronic).toBeCloseTo(last.chronic, 2);
    expect(lp.acute).toBeCloseTo(last.acute, 2);
    expect(lp.form).toBeCloseTo(last.form, 1);
    expect(lp.state).toBe(last.state);
    const withMissing = pts.find((p) => p.missing > 0)!;
    expect(withMissing.dayApprox).toBe(true);
  });
});
