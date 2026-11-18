import { describe, expect, it } from "vitest";
import { summarizeTrace } from "@/lib/perf/trace";

describe("summarizeTrace", () => {
  it("cuenta rondas en serie y paralelismo", () => {
    // ronda 1: dos a la vez; ronda 2: una; ronda 3: tres solapadas en cadena
    const s = summarizeTrace([
      { start: 0, end: 90 },
      { start: 5, end: 95 },
      { start: 100, end: 190 },
      { start: 200, end: 290 },
      { start: 250, end: 340 },
      { start: 330, end: 400 },
    ]);
    expect(s).toEqual({ queries: 6, dbMs: 90 + 90 + 90 + 90 + 90 + 70, serialRounds: 3, maxParallel: 2 });
  });
  it("todo en paralelo: una ronda", () => {
    expect(summarizeTrace([0, 1, 2, 3].map((i) => ({ start: i, end: 100 + i }))).serialRounds).toBe(1);
  });
  it("vacío", () => {
    expect(summarizeTrace([])).toEqual({ queries: 0, dbMs: 0, serialRounds: 0, maxParallel: 0 });
  });
});
