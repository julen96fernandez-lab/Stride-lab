import { describe, expect, it } from "vitest";
import { SUMMARY_RULES, hrReliable, pickSimilar, runSummary, type SimilarRun, type SummaryInput, type SummaryRun } from "@/lib/analysis/summary";

const run = (o: Partial<SummaryRun> = {}): SummaryRun => ({
  type: "rodaje", distanceM: 10000, durationS: 3000, paceS: 300, avgHr: 145,
  zoneSeconds: [600, 1900, 400, 100, 0], load: 60, isIndoor: false, temperatureC: 15, humidityPct: 60, ...o,
});
const sim = (o: Partial<SimilarRun> = {}): SimilarRun => ({ paceS: 315, avgHr: 145, hrReliable: true, load: 60, ...o });
const sum = (o: Partial<SummaryInput> & { run?: SummaryRun } = {}) =>
  runSummary({ run: run(), halves: null, decouplingOk: false, similar: [], ...o });
const text = (ls: { text: string }[]) => ls.map((l) => l.text).join(" ");
const NO_HR = /pulso|Z\d|zona|desacople/i;

describe("resumen: no afirma sin datos", () => {
  it("sin pulso: nada de pulso, zonas ni desacople", () => {
    const ls = sum({
      run: run({ avgHr: null, zoneSeconds: null }),
      halves: { paceDeltaS: 2, decouplingPct: 3 },
      decouplingOk: true,
      similar: [sim(), sim(), sim()],
    });
    expect(text(ls)).not.toMatch(NO_HR);
    expect(ls[0].text).toBe("Rodaje de 10 km.");
  });
  it("pulso poco fiable (muestras < 80 % de la carrera): tampoco", () => {
    const r = run({ zoneSeconds: [600, 600, 0, 0, 0] }); // 1200 s de 3000
    expect(hrReliable({ avgHr: r.avgHr, zoneSeconds: r.zoneSeconds, durationS: r.durationS })).toBe(false);
    expect(text(sum({ run: r, halves: { paceDeltaS: 0, decouplingPct: 9 }, decouplingOk: true, similar: [sim(), sim(), sim()] }))).not.toMatch(NO_HR);
  });
  it("con menos de 3 parecidas no compara", () => {
    expect(text(sum({ similar: [sim(), sim()] }))).not.toMatch(/últimos|parecid/);
  });
  it("sin mitades no habla de mitades; sin temperatura ni humedad, nada de entorno", () => {
    expect(text(sum({ run: run({ temperatureC: null, humidityPct: null }) }))).not.toMatch(/mitad|Coincidió/);
  });
  it("nunca causas", () => {
    const ls = sum({ run: run({ temperatureC: 30, humidityPct: 90, zoneSeconds: [0, 1000, 1500, 500, 0] }), halves: { paceDeltaS: 20, decouplingPct: 9 }, decouplingOk: true, similar: [sim({ avgHr: 130 }), sim({ avgHr: 130 }), sim({ avgHr: 130 })] });
    expect(text(ls)).not.toMatch(/por culpa|porque|debido|causa/i);
  });
});

describe("resumen: el tipo y si el pulso encaja", () => {
  it("rodaje: ≥ 70 % en Z1–Z2 encaja (bien); si no, a tener en cuenta", () => {
    expect(sum().at(0)).toEqual({ text: "Rodaje de 10 km; el pulso encaja con el tipo: el 83 % del tiempo en Z1–Z2.", tone: "good" });
    const w = sum({ run: run({ zoneSeconds: [0, 1500, 1200, 300, 0] }) })[0];
    expect(w).toEqual({ text: "Rodaje de 10 km; más tiempo en Z3 o más de lo habitual en un rodaje: solo el 50 % en Z1–Z2.", tone: "watch" });
  });
  it("tempo ≥ 40 % en Z3–Z4; series ≥ 15 % en Z4–Z5", () => {
    expect(sum({ run: run({ type: "tempo", zoneSeconds: [0, 1200, 1500, 300, 0] }) })[0].tone).toBe("good");
    expect(sum({ run: run({ type: "tempo", zoneSeconds: [600, 1900, 400, 100, 0] }) })[0].text).toMatch(/poco tiempo en Z3–Z4 para un tempo \(17 %\)/);
    expect(sum({ run: run({ type: "series", zoneSeconds: [600, 1200, 600, 400, 200] }) })[0].text).toMatch(/el 20 % del tiempo en Z4–Z5/);
    expect(sum({ run: run({ type: "series", zoneSeconds: [600, 1700, 600, 100, 0] }) })[0].text).toMatch(/poco tiempo en Z4–Z5 para unas series/);
  });
  it("tipos sin regla de zonas (trail, cinta…): solo el tipo y la distancia", () => {
    expect(sum({ run: run({ type: "trail" }) })[0]).toEqual({ text: "Trail de 10 km.", tone: "neutral" });
  });
});

describe("resumen: frente a las parecidas", () => {
  it("mejor ritmo medio (bien), más lento (neutral) o parecido", () => {
    expect(sum({ similar: [sim(), sim(), sim(), sim(), sim()] })[1]).toEqual({ text: "Mejor ritmo medio que tus últimos 5 rodajes parecidos (5:00 frente a 5:15 /km).", tone: "good" });
    expect(sum({ similar: [sim({ paceS: 290 }), sim({ paceS: 290 }), sim({ paceS: 290 })] })[1].tone).toBe("neutral");
    expect(sum({ similar: [sim({ paceS: 302 }), sim({ paceS: 302 }), sim({ paceS: 302 })] })[1].text).toMatch(/^Ritmo medio parecido/);
    expect(sum({ run: run({ type: "tirada_larga", zoneSeconds: [600, 1900, 400, 100, 0] }), similar: [sim(), sim(), sim()] })[1].text).toMatch(/tus últimas 3 tiradas largas parecidas/);
  });
  it("pulso más alto de lo habitual para ese ritmo (a tener en cuenta) y más bajo (bien)", () => {
    // mismo ritmo, 10 ppm más: ≈ 7 % peor
    const hi = sum({ similar: [sim({ paceS: 300, avgHr: 135 }), sim({ paceS: 300, avgHr: 135 }), sim({ paceS: 300, avgHr: 135 })] });
    expect(hi.find((l) => /más alto/.test(l.text))).toEqual({ text: "Pulso más alto de lo habitual para ese ritmo (frente a tus rodajes parecidos con pulso).", tone: "watch" });
    const lo = sum({ similar: [sim({ paceS: 300, avgHr: 160 }), sim({ paceS: 300, avgHr: 160 }), sim({ paceS: 300, avgHr: 160 })] });
    expect(lo.find((l) => /más bajo/.test(l.text))?.tone).toBe("good");
  });
  it("relación ritmo/pulso solo con 3 parecidas con pulso fiable", () => {
    const ls = sum({ similar: [sim({ avgHr: 120 }), sim({ avgHr: 120, hrReliable: false }), sim({ avgHr: null, hrReliable: false })] });
    expect(text(ls)).not.toMatch(/Pulso más/);
  });
  it("carga más alta o más baja a partir de un 10 %", () => {
    const ls = sum({ run: run({ temperatureC: null, humidityPct: null }), similar: [sim({ load: 50 }), sim({ load: 50 }), sim({ load: 50 })] });
    expect(ls.find((l) => /Carga/.test(l.text))?.text).toBe("Carga más alta que en tus rodajes parecidos (60 frente a 50).");
  });
});

describe("resumen: mitades, desacople y entorno", () => {
  it("mitades: más rápida (bien), más lenta (atención), parejas; en series no", () => {
    expect(text(sum({ halves: { paceDeltaS: -12, decouplingPct: null } }))).toMatch(/Segunda mitad más rápida que la primera \(12 s\/km\)/);
    expect(sum({ halves: { paceDeltaS: 9, decouplingPct: null } }).find((l) => /mitad/.test(l.text))?.tone).toBe("watch");
    expect(text(sum({ halves: { paceDeltaS: 3, decouplingPct: null } }))).toMatch(/Mitades parejas/);
    expect(text(sum({ run: run({ type: "series", zoneSeconds: [600, 1200, 600, 400, 200] }), halves: { paceDeltaS: 30, decouplingPct: null } }))).not.toMatch(/mitad/i);
  });
  it("desacople solo si vale para la sesión y hay pulso fiable", () => {
    expect(sum({ halves: { paceDeltaS: 0, decouplingPct: 7.2 }, decouplingOk: true }).find((l) => /desacople/.test(l.text))).toEqual({ text: "El pulso subió al mismo ritmo en la segunda mitad (desacople del 7,2 %).", tone: "watch" });
    expect(sum({ halves: { paceDeltaS: 0, decouplingPct: 3.1 }, decouplingOk: true }).find((l) => /desacople/.test(l.text))?.tone).toBe("good");
    expect(text(sum({ halves: { paceDeltaS: 0, decouplingPct: 7.2 }, decouplingOk: false }))).not.toMatch(/desacople/);
  });
  it("calor, frío y humedad como coincidencia; en cinta, no", () => {
    expect(text(sum({ run: run({ temperatureC: 27, humidityPct: 85 }) }))).toMatch(/Coincidió con calor \(27 °C\) y humedad alta \(85 %\); con calor o humedad el pulso suele subir\./);
    expect(text(sum({ run: run({ temperatureC: 1 }) }))).toMatch(/Coincidió con frío \(1 °C\)\./);
    expect(text(sum({ run: run({ temperatureC: 30, isIndoor: true }) }))).not.toMatch(/Coincidió/);
  });
  it("como mucho 5 frases, en orden", () => {
    const ls = sum({
      run: run({ temperatureC: 30 }),
      halves: { paceDeltaS: -10, decouplingPct: 2 },
      decouplingOk: true,
      similar: [sim({ load: 40, avgHr: 160 }), sim({ load: 40, avgHr: 160 }), sim({ load: 40, avgHr: 160 })],
    });
    expect(ls.length).toBe(SUMMARY_RULES.maxLines);
    expect(ls[0].text).toMatch(/^Rodaje/);
    expect(text(ls)).not.toMatch(/Carga/); // la menos prioritaria se cae
  });
});

describe("sesiones parecidas", () => {
  const at = (d: string) => new Date(`${d}T08:00:00Z`);
  const cur = { id: "c", type: "rodaje", startAt: at("2026-11-10"), distanceM: 10000 };
  const r = (id: string, d: string, o: Partial<{ type: string; distanceM: number; isSpecial: boolean }> = {}) => ({ id, type: "rodaje", startAt: at(d), distanceM: 10000, isSpecial: false, ...o });
  it("mismo tipo, ±20 %, 12 meses anteriores, sin especiales ni la propia; las 5 últimas", () => {
    const runs = [
      r("c", "2026-11-10"),
      r("after", "2026-11-12"),
      r("old", "2025-11-01"),
      r("tipo", "2026-11-01", { type: "series" }),
      r("lejos", "2026-11-01", { distanceM: 12500 }),
      r("borde", "2026-11-02", { distanceM: 12000 }),
      r("esp", "2026-11-03", { isSpecial: true }),
      ...["2026-10-01", "2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01"].map((d, i) => r(`s${i}`, d)),
    ];
    expect(pickSimilar(cur, runs).map((x) => x.id)).toEqual(["borde", "s0", "s1", "s2", "s3"]);
  });
  it("sin tipo o sin distancia, ninguna", () => {
    expect(pickSimilar({ ...cur, type: null }, [r("a", "2026-11-01")])).toEqual([]);
    expect(pickSimilar({ ...cur, distanceM: null }, [r("a", "2026-11-01")])).toEqual([]);
  });
});
