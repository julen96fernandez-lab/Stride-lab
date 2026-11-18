/**
 * Carreras objetivo: validación del formulario, etiqueta de realismo del tiempo objetivo,
 * cuenta atrás y perfil de altitud del GPX (escalado a la distancia oficial). Lógica pura.
 */
import { cumulativeDistance, type GpxPoint } from "@/lib/import/gpx";

export type RaceDistanceKey = "5k" | "10k" | "half" | "marathon" | "other";
export const RACE_DISTANCES: Record<Exclude<RaceDistanceKey, "other">, { label: string; m: number }> = {
  "5k": { label: "5K", m: 5000 },
  "10k": { label: "10K", m: 10000 },
  half: { label: "Media maratón", m: 21097.5 },
  marathon: { label: "Maratón", m: 42195 },
};

export interface RaceInput {
  name: string;
  date: string;
  distanceKey: RaceDistanceKey;
  distanceM: number;
  /** HH:MM o null */
  startTime: string | null;
  targetS: number;
}

export type RaceErrors = Partial<Record<"name" | "date" | "distance" | "startTime" | "target" | "gpx", string>>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Tiempo «h:mm:ss», «mm:ss» o «h:mm» (si lleva 2 partes y la primera < 10 con distancia larga, se lee como h:mm). */
export function parseTime(s: string): number | null {
  const parts = s.trim().split(":").map((x) => x.trim());
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 3 && n[1] < 60 && n[2] < 60) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 2 && n[1] < 60) return n[0] * 60 + n[1];
  return null;
}

export function fmtTime(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function parseRaceForm(f: Record<string, string | undefined>, today: string): { input: RaceInput | null; errors: RaceErrors } {
  const errors: RaceErrors = {};
  const name = (f.name ?? "").trim().slice(0, 80);
  if (!name) errors.name = "Ponle un nombre a la carrera.";
  const date = (f.date ?? "").trim();
  const real = YMD.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
  if (!real) errors.date = "Indica la fecha de la carrera.";
  const key = (f.distanceKey ?? "") as RaceDistanceKey;
  let distanceM = 0;
  if (key in RACE_DISTANCES) distanceM = RACE_DISTANCES[key as keyof typeof RACE_DISTANCES].m;
  else if (key === "other") {
    const km = Number(String(f.distanceKm ?? "").replace(",", "."));
    if (!(km >= 1 && km <= 250)) errors.distance = "Distancia entre 1 y 250 km.";
    else distanceM = Math.round(km * 1000);
  } else errors.distance = "Elige la distancia.";
  const st = (f.startTime ?? "").trim();
  if (st && !/^([01]\d|2[0-3]):[0-5]\d$/.test(st)) errors.startTime = "Hora de salida no válida (hh:mm).";
  const t = parseTime(f.target ?? "");
  if (t === null) errors.target = "Tiempo objetivo no válido (h:mm:ss).";
  else if (distanceM && (t / (distanceM / 1000) < 150 || t / (distanceM / 1000) > 900)) errors.target = "Ritmo imposible: revisa el tiempo objetivo.";
  void today;
  if (Object.keys(errors).length) return { input: null, errors };
  return { input: { name, date, distanceKey: key, distanceM, startTime: st || null, targetS: t! }, errors };
}

export type Realism = "realista" | "conservador" | "ambicioso" | "muy_ambicioso";
export const REALISM_LABEL: Record<Realism, string> = {
  realista: "Realista",
  conservador: "Conservador",
  ambicioso: "Ambicioso",
  muy_ambicioso: "Muy ambicioso",
};
/** Más rápido que el límite inferior del rango en más de este tanto → muy ambicioso. */
export const VERY_AMBITIOUS = 0.03;

/**
 * Dentro del rango de la predicción → realista; más rápido que su límite inferior → ambicioso
 * (más de un 3 % → muy ambicioso); más lento que el superior → conservador. Sin predicción, null.
 */
export function realism(targetS: number, range: { lowS: number; highS: number } | null): Realism | null {
  if (!range) return null;
  if (targetS < range.lowS * (1 - VERY_AMBITIOUS)) return "muy_ambicioso";
  if (targetS < range.lowS) return "ambicioso";
  if (targetS > range.highS) return "conservador";
  return "realista";
}

/** Días que faltan (0 = hoy, negativo = ya pasó), con días de calendario. */
export function daysUntil(raceDate: string, today: string): number {
  return Math.round((Date.parse(`${raceDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function countdownText(days: number): string {
  if (days < 0) return days === -1 ? "Fue ayer" : `Fue hace ${-days} días`;
  if (days === 0) return "¡Es hoy!";
  if (days === 1) return "Mañana";
  if (days < 14) return `Faltan ${days} días`;
  const w = Math.floor(days / 7);
  const d = days % 7;
  return `Faltan ${w} semanas${d ? ` y ${d} ${d === 1 ? "día" : "días"}` : ""} (${days} días)`;
}

export interface RaceProfile {
  /** distancia (m, ya escalada a la oficial) y altitud (m), un punto cada ~50 m */
  d: number[];
  e: number[];
  gpxM: number;
  /** oficial / GPX (1 = coinciden) */
  scale: number;
  gainM: number;
}

/**
 * Perfil de altitud del GPX escalado a la distancia oficial (el GPX solo da la forma). null si
 * no trae altitud o tiene menos de 2 puntos.
 */
export function raceProfile(pts: readonly GpxPoint[], officialM: number, stepM = 50): RaceProfile | null {
  const withEle = pts.filter((p) => p.ele !== null);
  if (withEle.length < 2) return null;
  const cum = cumulativeDistance(withEle as GpxPoint[]);
  const gpxM = cum[cum.length - 1];
  if (!(gpxM > 100)) return null;
  const scale = officialM / gpxM;
  const d: number[] = [];
  const e: number[] = [];
  let j = 0;
  for (let x = 0; x <= gpxM + 1e-6; x += stepM) {
    while (j < cum.length - 2 && cum[j + 1] < x) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const f = Math.max(0, Math.min(1, (x - cum[j]) / span));
    d.push(Math.round(x * scale * 10) / 10);
    e.push(Math.round((withEle[j].ele! + f * (withEle[j + 1].ele! - withEle[j].ele!)) * 10) / 10);
  }
  if (d[d.length - 1] < officialM - 1) {
    d.push(officialM);
    e.push(withEle[withEle.length - 1].ele!);
  }
  let gain = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[i - 1]) gain += e[i] - e[i - 1];
  return { d, e, gpxM, scale, gainM: Math.round(gain) };
}
