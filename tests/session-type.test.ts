import { describe, expect, it } from "vitest";
import { classifySessionTypes, type RunForType } from "@/lib/analysis/session-type";

let n = 0;
const base = (o: Partial<RunForType>): RunForType => ({
  id: `r${n++}`,
  startAt: new Date("2026-06-01T08:00:00Z"),
  distanceM: 8000,
  avgPaceSPerKm: 330,
  avgHr: 145,
  isIndoor: false,
  isSpecial: false,
  elevationGainM: 40,
  intervalSteps: null,
  ...o,
});

/** 10 rodajes previos a 5:30 y 145 ppm como media. */
const history = Array.from({ length: 10 }, (_, i) =>
  base({ id: `h${i}`, startAt: new Date(Date.UTC(2026, 3, 1 + i * 5)), avgPaceSPerKm: 330, avgHr: 145 }),
);

describe("clasificación de tipos de sesión", () => {
  it("aplica las reglas en orden", () => {
    const runs = [
      ...history,
      base({ id: "int", intervalSteps: ["0.0.0", "1.0.0", "1.0.1", "1.1.0", "1.1.1", "2.0.0"], isIndoor: true, distanceM: 20000 }), // series gana a cinta y tirada
      base({ id: "ind", isIndoor: true }),
      base({ id: "long", distanceM: 16_000 }),
      base({ id: "trail", distanceM: 10_000, elevationGainM: 300 }),
      base({ id: "tempo", avgPaceSPerKm: 300, avgHr: 156 }),
      base({ id: "rec", avgPaceSPerKm: 370, avgHr: 135 }),
      base({ id: "easy", avgPaceSPerKm: 335, avgHr: 146 }),
      base({ id: "fastNoHr", avgPaceSPerKm: 300, avgHr: null }),
    ];
    const r = classifySessionTypes(runs);
    expect(r.get("int")!.type).toBe("series");
    expect(r.get("ind")!.type).toBe("cinta");
    expect(r.get("long")!.type).toBe("tirada_larga");
    expect(r.get("trail")!.type).toBe("trail");
    expect(r.get("tempo")!.type).toBe("tempo");
    expect(r.get("tempo")!.reason).toMatch(/9 % más rápido y FC \+11 ppm/);
    expect(r.get("rec")!.type).toBe("recuperacion");
    expect(r.get("easy")!.type).toBe("rodaje");
    expect(r.get("fastNoHr")!.type).toBe("tempo"); // 9 % ≥ 7 % sin pulso
  });

  it("umbrales configurables", () => {
    const runs = [...history, base({ id: "x", distanceM: 12_000 }), base({ id: "y", distanceM: 6000, elevationGainM: 90 })];
    const r = classifySessionTypes(runs, { longRunKm: 12, trailMPerKm: 15 });
    expect(r.get("x")!.type).toBe("tirada_larga");
    expect(r.get("y")!.type).toBe("trail");
  });

  it("nunca propone Competición y, sin media, deja Rodaje con el motivo", () => {
    const r = classifySessionTypes([base({ id: "solo", avgPaceSPerKm: 250 })]);
    expect(r.get("solo")).toEqual({ type: "rodaje", reason: "Sin media suficiente para comparar" });
    const all = classifySessionTypes([...history, base({ avgPaceSPerKm: 200, avgHr: 190 })]);
    expect([...all.values()].some((v) => v.type === "competicion")).toBe(false);
  });
});

describe("detección de series", () => {
  it("rodaje con solo 0.0.0 no es serie; series con 5+ pasos y repetición sí", async () => {
    const { isIntervalWorkout } = await import("@/lib/analysis/session-type");
    expect(isIntervalWorkout(["0.0.0"])).toBe(false);
    expect(isIntervalWorkout(null)).toBe(false);
    expect(isIntervalWorkout(["0.0.0", "1.0.0", "2.0.0", "3.0.0", "4.0.0"])).toBe(false); // sin repetición
    expect(isIntervalWorkout(["0.0.0", "1.0.0", "1.0.1", "2.0.0"])).toBe(false); // < 5 distintas
    expect(isIntervalWorkout(["0.0.0", "1.0.0", "1.0.1", "1.1.0", "2.0.0"])).toBe(true);
    expect(isIntervalWorkout(["0.0.0", "1.0.0", "1.0.1", "1.0.1", "2.0.0"])).toBe(false); // repetidas no cuentan
  });
});
