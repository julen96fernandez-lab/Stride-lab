/**
 * Ejes con marcas regulares y rango ajustado a los datos (valores en segundos: ritmo o tiempo).
 * Elige el paso más pequeño de `steps` con el que caben como mucho `maxSteps` tramos; el rango
 * va de un múltiplo del paso por debajo del mínimo (con un pequeño margen) a otro por encima
 * del máximo, así todas las marcas están a la misma distancia.
 */
export interface RegularAxis {
  min: number;
  max: number;
  interval: number;
}

/** Ritmo: marcas cada 15 s o 30 s (60 s solo si el rango es muy amplio). */
export const PACE_STEPS = [15, 30, 60];
/** Tiempos de esfuerzos (1 km … maratón). */
export const TIME_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export function regularAxis(values: number[], maxSteps = 4, steps: number[] = PACE_STEPS, padPct = 0.03): RegularAxis {
  const vs = values.filter((v) => Number.isFinite(v));
  if (!vs.length) return { min: 240, max: 420, interval: steps[Math.min(1, steps.length - 1)] };
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.05, lo * padPct * 0.25);
  let last: RegularAxis | null = null;
  for (const interval of steps) {
    const min = Math.floor((lo - pad) / interval) * interval;
    let max = Math.ceil((hi + pad) / interval) * interval;
    if (max === min) max = min + interval;
    last = { min, max, interval };
    if ((max - min) / interval <= maxSteps) return last;
  }
  return last!;
}
