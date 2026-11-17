/**
 * Zonas de frecuencia cardíaca, tiempo en zona y carga por carrera.
 *
 * - 5 zonas definidas por su límite inferior en ppm (editables en Perfil).
 * - Valores: los del Apple Watch del usuario: reposo 47, FC máx. 187, reserva cardíaca;
 *   Z2…Z5 = 60/70/80/90 % de la reserva → 131, 145, 159, 173. Z1 es «por debajo de 131»
 *   (su límite inferior, 50 % → 117, solo sirve de referencia: lo que queda por debajo
 *   también cuenta como Z1).
 * - Tiempo en zona: cada muestra de FC cuenta hasta la siguiente (máx. 30 s, para no
 *   rellenar pausas ni huecos); lo que queda por debajo de Z1 se suma a Z1.
 * - Carga: minutos en cada zona × 1…5 (TRIMP de Edwards). Sin muestras de FC no hay carga.
 */

export type ZoneMethod = "reserve" | "max";

export interface HrZones {
  maxHr: number;
  restHr: number;
  method: ZoneMethod;
  /** Límite inferior (ppm) de Z1…Z5, crecientes. */
  limits: [number, number, number, number, number];
}

export const ZONE_PCTS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export function limitsFrom(maxHr: number, restHr: number, method: ZoneMethod): HrZones["limits"] {
  return ZONE_PCTS.map((p) => Math.round(method === "reserve" ? restHr + p * (maxHr - restHr) : p * maxHr)) as HrZones["limits"];
}

export const DEFAULT_ZONES: HrZones = { maxHr: 187, restHr: 47, method: "reserve", limits: limitsFrom(187, 47, "reserve") };

/** Comprueba que los límites son crecientes y razonables. */
export function validZones(z: HrZones): boolean {
  if (!(z.maxHr > z.restHr && z.maxHr <= 240 && z.restHr >= 25)) return false;
  for (let i = 0; i < 5; i++) {
    if (!Number.isFinite(z.limits[i]) || z.limits[i] < 40 || z.limits[i] > z.maxHr) return false;
    if (i > 0 && z.limits[i] <= z.limits[i - 1]) return false;
  }
  return true;
}

/** Zona (1…5) de un pulso; por debajo de Z1 cuenta como 1. */
export function zoneOf(hr: number, limits: HrZones["limits"]): 1 | 2 | 3 | 4 | 5 {
  let z = 1;
  for (let i = 1; i < 5; i++) if (hr >= limits[i]) z = i + 1;
  return z as 1 | 2 | 3 | 4 | 5;
}

const MAX_GAP_S = 30;
const LAST_SAMPLE_S = 5;

/** Segundos en Z1…Z5 a partir de las muestras de FC (t en s desde el inicio). */
export function timeInZones(t: readonly number[], v: readonly number[], limits: HrZones["limits"]): number[] {
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i < t.length; i++) {
    const dt = i + 1 < t.length ? Math.min(Math.max(0, t[i + 1] - t[i]), MAX_GAP_S) : LAST_SAMPLE_S;
    out[zoneOf(v[i], limits) - 1] += dt;
  }
  return out;
}

export function trainingLoad(zoneSeconds: readonly number[] | null): number | null {
  if (!zoneSeconds || zoneSeconds.reduce((a, b) => a + b, 0) <= 0) return null;
  return Math.round(zoneSeconds.reduce((a, s, i) => a + (s / 60) * (i + 1), 0));
}

/** Nivel de carga para el color: verde < 120, naranja 120–249, rojo ≥ 250. */
export const LOAD_LEVELS = { moderate: 120, high: 250 } as const;
export function loadLevel(load: number): "low" | "moderate" | "high" {
  return load >= LOAD_LEVELS.high ? "high" : load >= LOAD_LEVELS.moderate ? "moderate" : "low";
}
