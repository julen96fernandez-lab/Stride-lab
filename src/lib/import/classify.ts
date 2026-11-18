import type { RunSource, RunStatus } from "@/lib/db/schema";

/** Reglas decididas (docs/MASTER.md). */
export const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
export const MIN_VALID_DISTANCE_M = 500;
export const SPECIAL_PACE_S_PER_KM = 8 * 60;

export interface RunForClassify {
  id: string;
  source: RunSource;
  startAt: Date;
  distanceM: number | null;
  avgPaceSPerKm: number | null;
}

export interface Classification {
  status: RunStatus;
  invalidReason: string | null;
  duplicateOf: string | null;
  isSpecial: boolean;
}

/**
 * Deduplica Strava/otras fuentes frente a Apple Watch (inicio a ≤ 30 min, gana el
 * Watch), y marca validez (≥ 0,5 km) y sesión especial (> 8:00 /km).
 */
export function classifyRuns(runs: RunForClassify[]): Map<string, Classification> {
  const sorted = [...runs].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const watches = sorted.filter((r) => r.source === "apple_watch");
  const out = new Map<string, Classification>();

  for (const r of sorted) {
    let duplicateOf: string | null = null;
    // Las manuales no se marcan como duplicadas: si el zip trae la misma carrera, la sustituye
    // antes (replaceManualRuns); si no hay pareja clara, se quedan las dos.
    if (r.source !== "apple_watch" && r.source !== "manual") {
      let best: RunForClassify | null = null;
      let bestGap = Infinity;
      for (const w of watches) {
        const gap = Math.abs(w.startAt.getTime() - r.startAt.getTime());
        if (gap <= DUPLICATE_WINDOW_MS && gap < bestGap) {
          best = w;
          bestGap = gap;
        }
      }
      duplicateOf = best?.id ?? null;
    }

    let status: RunStatus = "valid";
    let invalidReason: string | null = null;
    if (duplicateOf) status = "duplicate";
    else if (r.distanceM === null) {
      status = "invalid";
      invalidReason = "sin_distancia";
    } else if (r.distanceM < MIN_VALID_DISTANCE_M) {
      status = "invalid";
      invalidReason = "menos_de_0_5_km";
    }

    const isSpecial = r.avgPaceSPerKm !== null && r.avgPaceSPerKm > SPECIAL_PACE_S_PER_KM;
    out.set(r.id, { status, invalidReason, duplicateOf, isSpecial });
  }
  return out;
}
