/** Ritmo a igual pulso por año (reglas en docs/MASTER.md). */

export const DEFAULT_HR_BAND: [number, number] = [140, 150];
export const MIN_DISTANCE_M = 5000;

export interface RunForPaceAtHr {
  year: number;
  distanceM: number | null;
  durationS: number;
  avgHr: number | null;
  isSpecial: boolean;
}

export interface YearPace {
  year: number;
  runs: number;
  /** Ritmo agregado (tiempo total / distancia total), s/km; null si no hay carreras. */
  paceSPerKm: number | null;
  avgHr: number | null;
  km: number;
}

/** Lee "140-150" con límites razonables; si no es válido, la franja por defecto. */
export function parseBand(raw: string | undefined | null): [number, number] {
  const m = /^(\d{2,3})-(\d{2,3})$/.exec(raw ?? "");
  if (!m) return DEFAULT_HR_BAND;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo >= 80 && hi <= 220 && hi - lo >= 4 && hi - lo <= 40 ? [lo, hi] : DEFAULT_HR_BAND;
}

/** Un registro por año entre `fromYear` y `toYear`, también los años sin carreras. */
export function paceAtHrByYear(runs: RunForPaceAtHr[], band: [number, number], fromYear: number, toYear: number): YearPace[] {
  const acc = new Map<number, { n: number; t: number; d: number; hrT: number }>();
  for (const r of runs) {
    if (r.isSpecial || r.distanceM === null || r.distanceM < MIN_DISTANCE_M || r.avgHr === null) continue;
    if (r.avgHr < band[0] || r.avgHr > band[1]) continue;
    const a = acc.get(r.year) ?? { n: 0, t: 0, d: 0, hrT: 0 };
    a.n++;
    a.t += r.durationS;
    a.d += r.distanceM;
    a.hrT += r.avgHr * r.durationS;
    acc.set(r.year, a);
  }
  const out: YearPace[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const a = acc.get(y);
    out.push(
      a
        ? { year: y, runs: a.n, paceSPerKm: a.t / (a.d / 1000), avgHr: a.hrT / a.t, km: a.d / 1000 }
        : { year: y, runs: 0, paceSPerKm: null, avgHr: null, km: 0 },
    );
  }
  return out;
}

/** Franjas del selector «Ritmo con el mismo pulso». */
export const HR_BANDS: [number, number][] = [
  [130, 140],
  [135, 145],
  [140, 150],
  [145, 155],
  [150, 160],
];
