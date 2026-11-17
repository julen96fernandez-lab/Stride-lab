/**
 * Durabilidad: primera mitad frente a segunda mitad (por distancia).
 * - Ritmo de cada mitad.
 * - FC media de cada mitad (si hay muestras).
 * - Desacople = caída de eficiencia (velocidad / FC) de la 1.ª a la 2.ª mitad, en %.
 * Nada se estima: si falta un dato, el resultado lo deja en null.
 */
import { cumulativeFromIntervals, meanInRange, type Series } from "@/lib/import/splits";

export interface Half {
  distanceM: number;
  durationS: number;
  paceSPerKm: number;
  avgHr: number | null;
}

export interface Durability {
  first: Half;
  second: Half;
  /** % (positivo = la 2.ª mitad cuesta más pulso por la misma velocidad). */
  decouplingPct: number | null;
  /** Diferencia de ritmo 2.ª − 1.ª mitad, en s/km (positivo = más lenta). */
  paceDeltaS: number;
  basis: "samples" | "splits";
}

function timeAtDistance(cum: Series, target: number): number | null {
  for (let i = 1; i < cum.v.length; i++) {
    if (cum.v[i] >= target) {
      const d0 = cum.v[i - 1],
        d1 = cum.v[i];
      const f = d1 > d0 ? (target - d0) / (d1 - d0) : 1;
      return cum.t[i - 1] + f * (cum.t[i] - cum.t[i - 1]);
    }
  }
  return null;
}

function build(totalD: number, tHalf: number, tEnd: number, tStart: number, hr: Series | undefined, basis: Durability["basis"]): Durability | null {
  const half = totalD / 2;
  const d1 = tHalf - tStart;
  const d2 = tEnd - tHalf;
  if (!(half > 0 && d1 > 0 && d2 > 0)) return null;
  const hr1 = meanInRange(hr, tStart, tHalf);
  const hr2 = meanInRange(hr, tHalf, tEnd);
  const p1 = d1 / (half / 1000);
  const p2 = d2 / (half / 1000);
  let decouplingPct: number | null = null;
  if (hr1 && hr2) {
    const ef1 = half / d1 / hr1;
    const ef2 = half / d2 / hr2;
    decouplingPct = ((ef1 - ef2) / ef1) * 100;
  }
  return {
    first: { distanceM: half, durationS: d1, paceSPerKm: p1, avgHr: hr1 },
    second: { distanceM: half, durationS: d2, paceSPerKm: p2, avgHr: hr2 },
    decouplingPct,
    paceDeltaS: p2 - p1,
    basis,
  };
}

/** Con la distancia del reloj (muestras por intervalo). */
export function durabilityFromSeries(distanceIntervals: Series, hr?: Series): Durability | null {
  if (distanceIntervals.t.length < 4) return null;
  const cum = cumulativeFromIntervals(distanceIntervals);
  const total = cum.v[cum.v.length - 1];
  if (total < 1000) return null;
  const tHalf = timeAtDistance(cum, total / 2);
  if (tHalf === null) return null;
  return build(total, tHalf, cum.t[cum.t.length - 1], cum.t[0], hr, "samples");
}

/** Respaldo con los parciales por km (si no hay muestras de distancia). */
export function durabilityFromSplits(splits: { distanceM: number; durationS: number }[], hr?: Series): Durability | null {
  if (splits.length < 2) return null;
  const t = [0];
  const v = [0];
  for (const s of splits) {
    t.push(t[t.length - 1] + s.durationS);
    v.push(v[v.length - 1] + s.distanceM);
  }
  const total = v[v.length - 1];
  if (total < 1000) return null;
  const tHalf = timeAtDistance({ t, v }, total / 2);
  if (tHalf === null) return null;
  return build(total, tHalf, t[t.length - 1], 0, hr, "splits");
}
