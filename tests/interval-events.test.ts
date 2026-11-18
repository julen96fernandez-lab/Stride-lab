import { describe, expect, it } from "vitest";
import { intervalEvents } from "@/lib/import/interval-events";

const T0 = Date.parse("2026-10-06T15:48:42Z");
const at = (s: number) => {
  const d = new Date(T0 + s * 1000 + 3600_000); // hora local +01:00
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0100`;
};
const ev = (k: string, s: number, durMin?: number) =>
  `<WorkoutEvent type="HKWorkoutEventTypeSegment" date="${at(s)}"${durMin !== undefined ? ` duration="${durMin}" durationUnit="min"` : ""}>\n <MetadataEntry key="WOIntervalStepKeyPath" value="${k}"/>\n</WorkoutEvent>`;

describe("pasos de intervalos del Apple Watch", () => {
  it("con duración: hora de inicio y duración de cada paso", () => {
    const xml = [ev("0.0.0", 0, 10), ev("1.0.0", 600, 2), ev("1.0.1", 720, 1.5), ev("1.1.0", 810, 2), ev("2.0.0", 930, 5)].join("\n");
    expect(intervalEvents(xml, T0, T0 + 1230_000)).toEqual([
      { key: "0.0.0", startS: 0, durationS: 600 },
      { key: "1.0.0", startS: 600, durationS: 120 },
      { key: "1.0.1", startS: 720, durationS: 90 },
      { key: "1.1.0", startS: 810, durationS: 120 },
      { key: "2.0.0", startS: 930, durationS: 300 },
    ]);
  });

  it("sin duración: hasta el paso siguiente o el final del entrenamiento", () => {
    const xml = [ev("1.0.1", 720), ev("1.0.0", 600), ev("2.0.0", 900)].join("\n");
    expect(intervalEvents(xml, T0, T0 + 1000_000)).toEqual([
      { key: "1.0.0", startS: 600, durationS: 120 },
      { key: "1.0.1", startS: 720, durationS: 180 },
      { key: "2.0.0", startS: 900, durationS: 100 },
    ]);
  });

  it("como WorkoutActivity con fechas (exports recientes); sin duplicar claves", () => {
    const act = (k: string, s: number, e: number) =>
      `<WorkoutActivity uuid="x" startDate="${at(s)}" endDate="${at(e)}"><MetadataEntry key="WOIntervalStepKeyPath" value="${k}"/></WorkoutActivity>`;
    const xml = [act("1.0.0", 600, 720), ev("1.0.0", 601), act("1.0.1", 720, 810)].join("\n");
    expect(intervalEvents(xml, T0, T0 + 900_000)).toEqual([
      { key: "1.0.0", startS: 600, durationS: 120 },
      { key: "1.0.1", startS: 720, durationS: 90 },
    ]);
  });

  it("eventos sin clave de paso (pausas, vueltas) se ignoran", () => {
    const xml = `<WorkoutEvent type="HKWorkoutEventTypePause" date="${at(100)}"/>` + ev("0.0.0", 0, 1);
    expect(intervalEvents(xml, T0, T0 + 200_000)).toEqual([{ key: "0.0.0", startS: 0, durationS: 60 }]);
  });
});
