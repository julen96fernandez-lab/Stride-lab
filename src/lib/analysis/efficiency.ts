/**
 * Eficiencia aeróbica.
 *
 * - Desacople aeróbico (pulso frente a ritmo, 1.ª frente a 2.ª mitad; ver durability.ts): solo
 *   tiene sentido en carreras continuas a ritmo estable y con pulso. Se muestra solo en Rodaje y
 *   Tirada larga con al menos 4 parciales completos y una variación de ritmo entre parciales
 *   (coeficiente de variación) de como mucho el 5 %.
 * - Ritmo en Z2: ritmo medio (por distancia) de los instantes en que el pulso está en la zona 2,
 *   con al menos 5 minutos en esa zona. Usa la línea de tiempo del detalle (ritmo suavizado con las
 *   reglas de validez de los récords), así que no cuenta pausas ni muestras imposibles.
 */
export const STABLE_CV = 0.05;
export const MIN_STABLE_SPLITS = 4;
export const MIN_Z2_SECONDS = 300;
export const DECOUPLING_TYPES = ["rodaje", "tirada_larga"] as const;

/** Coeficiente de variación del ritmo de los parciales completos (≥ 990 m). */
export function paceVariation(splits: readonly { distanceM: number; paceSPerKm: number | null }[]): { cv: number; n: number } | null {
  const p = splits.filter((s) => s.distanceM >= 990 && s.paceSPerKm !== null).map((s) => s.paceSPerKm!);
  if (p.length < 2) return null;
  const mean = p.reduce((a, b) => a + b, 0) / p.length;
  const sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length);
  return { cv: sd / mean, n: p.length };
}

export type DecouplingCheck = { ok: true; cv: number } | { ok: false; reason: string };

export function decouplingEligible(input: {
  type: string | null;
  hasHr: boolean;
  splits: readonly { distanceM: number; paceSPerKm: number | null }[];
}): DecouplingCheck {
  if (!input.type || !(DECOUPLING_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, reason: "El desacople solo se calcula en Rodaje y Tirada larga." };
  }
  if (!input.hasHr) return { ok: false, reason: "Sin pulso no hay desacople." };
  const v = paceVariation(input.splits);
  if (!v || v.n < MIN_STABLE_SPLITS) return { ok: false, reason: `Hacen falta al menos ${MIN_STABLE_SPLITS} km completos.` };
  if (v.cv > STABLE_CV) {
    return { ok: false, reason: `Ritmo poco estable (los parciales varían un ${(v.cv * 100).toFixed(1).replace(".", ",")} %; el límite es ${STABLE_CV * 100} %).` };
  }
  return { ok: true, cv: v.cv };
}

/** Lectura breve del desacople para la pantalla. */
export function decouplingLabel(pct: number): string {
  if (pct < 0) return "Sin desacople: la segunda mitad te costó menos pulso a la misma velocidad.";
  if (pct <= 5) return "Bajo (≤ 5 %): buena base aeróbica para este ritmo y duración.";
  if (pct <= 10) return "Moderado (5–10 %): el pulso subió más que el ritmo en la segunda mitad.";
  return "Alto (> 10 %): el ritmo o la duración fueron exigentes para tu base aeróbica actual (o influyeron calor, cuestas o cansancio).";
}

/**
 * Ritmo en Z2 de una carrera: velocidad media de los instantes con pulso en [lo, hi] y ritmo
 * válido. `stepS` = segundos que representa cada instante de la rejilla.
 */
export function paceInHrBand(
  pace: readonly (number | null)[],
  hr: readonly (number | null)[] | null,
  stepS: number,
  band: readonly [number, number],
): { paceSPerKm: number; seconds: number } | null {
  if (!hr) return null;
  let n = 0;
  let speed = 0;
  for (let i = 0; i < pace.length; i++) {
    const p = pace[i];
    const h = hr[i];
    if (p === null || h === null || h < band[0] || h > band[1]) continue;
    speed += 1000 / p;
    n++;
  }
  const seconds = n * stepS;
  if (seconds < MIN_Z2_SECONDS || n === 0) return null;
  return { paceSPerKm: 1000 / (speed / n), seconds };
}

/** Límites de Z2 (incluidos) a partir de los límites inferiores de las zonas: [Z2, Z3 − 1]. */
export function z2Band(limits: readonly number[]): [number, number] {
  return [limits[1], limits[2] - 1];
}
