import type { RunSource } from "@/lib/db/schema";
import { attr, childTags, parseAttrs, parseHealthDate } from "./xml";
import {
  bool01,
  elevationM,
  humidityPct,
  temperatureC,
  toCm,
  toKcal,
  toMeters,
  toMps,
  toMs,
  toNumber,
  toSeconds,
} from "./units";

export const RUNNING = "HKWorkoutActivityTypeRunning";
const Q = "HKQuantityTypeIdentifier";

/** Carrera tal como sale del XML, antes de deduplicar y clasificar. */
export interface ParsedRun {
  sourceKey: string;
  source: RunSource;
  sourceName: string | null;
  sourceVersion: string | null;
  device: string | null;
  startAt: Date;
  endAt: Date;
  durationS: number;
  distanceM: number | null;
  avgPaceSPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPowerW: number | null;
  avgSpeedMps: number | null;
  avgStrideM: number | null;
  avgVerticalOscCm: number | null;
  avgGroundContactMs: number | null;
  steps: number | null;
  cadenceSpm: number | null;
  elevationGainM: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  isIndoor: boolean | null;
  activeEnergyKcal: number | null;
  routeFile: string | null;
  raw: Record<string, unknown>;
}

/** Tipo de actividad sin parsear el elemento entero (para descartar rápido). */
export function workoutActivityType(xml: string): string | undefined {
  const end = xml.indexOf(">");
  return attr(end === -1 ? xml : xml.slice(0, end + 1), "workoutActivityType");
}

export function detectSource(sourceName: string | null, device: string | null): RunSource {
  const s = `${sourceName ?? ""} ${device ?? ""}`;
  if (/strava/i.test(s)) return "strava";
  if (/watch/i.test(s)) return "apple_watch";
  return "other";
}

/** Primera aparición de cada estadística, indexada por tipo sin prefijo. */
function firstStatistics(xml: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const s of childTags(xml, "WorkoutStatistics")) {
    const type = (s.type ?? "").replace(Q, "");
    if (type && !out.has(type)) out.set(type, s);
  }
  return out;
}

function firstMetadata(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of childTags(xml, "MetadataEntry")) {
    if (m.key && m.value !== undefined && !out.has(m.key)) out.set(m.key, m.value);
  }
  return out;
}

function routeFileOf(xml: string): string | null {
  const i = xml.indexOf("<WorkoutRoute");
  if (i === -1) return null;
  const route = xml.slice(i, xml.indexOf("</WorkoutRoute>", i) + 1 || undefined);
  const ref = childTags(route, "FileReference")[0]?.path;
  return ref ? ref.replace(/^\/+/, "") : null;
}

/**
 * Convierte un elemento `<Workout>…</Workout>` en carrera.
 * Devuelve null si no es de correr o le faltan fechas.
 */
export function parseRunningWorkout(xml: string): ParsedRun | null {
  if (workoutActivityType(xml) !== RUNNING) return null;
  const a = parseAttrs(xml);
  const startAt = parseHealthDate(a.startDate);
  const endAt = parseHealthDate(a.endDate);
  if (!startAt || !endAt) return null;

  const stats = firstStatistics(xml);
  const meta = firstMetadata(xml);
  const st = (type: string, field: "sum" | "average" | "maximum" | "minimum") => {
    const s = stats.get(type);
    return s ? { value: s[field], unit: s.unit } : { value: undefined, unit: undefined };
  };

  const durationS =
    toSeconds(a.duration, a.durationUnit) ?? Math.max(0, (endAt.getTime() - startAt.getTime()) / 1000);

  // Distancia: estadística DistanceWalkingRunning (sum). Respaldo: atributo antiguo totalDistance.
  const dist = st("DistanceWalkingRunning", "sum");
  let distanceM = toMeters(dist.value, dist.unit);
  let distanceFrom: string | null = distanceM !== null ? "WorkoutStatistics" : null;
  if (distanceM === null && a.totalDistance) {
    distanceM = toMeters(a.totalDistance, a.totalDistanceUnit);
    if (distanceM !== null) distanceFrom = "totalDistance";
  }

  const hrAvg = st("HeartRate", "average");
  const hrMax = st("HeartRate", "maximum");
  const power = st("RunningPower", "average");
  const speed = st("RunningSpeed", "average");
  const stride = st("RunningStrideLength", "average");
  const vo = st("RunningVerticalOscillation", "average");
  const gct = st("RunningGroundContactTime", "average");
  const stepsSum = st("StepCount", "sum");
  const energy = st("ActiveEnergyBurned", "sum");

  const steps = toNumber(stepsSum.value);
  const sourceName = a.sourceName ?? null;
  const device = a.device ?? null;

  // Todas las rutas de paso de intervalos (no solo la primera): sirven para distinguir
  // series reales de rodajes, donde el reloj pone solo "0.0.0".
  const intervalSteps = [
    ...new Set(
      childTags(xml, "MetadataEntry")
        .filter((m) => m.key === "WOIntervalStepKeyPath" && m.value)
        .map((m) => m.value),
    ),
  ].sort();

  const raw: Record<string, unknown> = {
    attributes: a,
    statistics: Object.fromEntries(stats),
    metadata: Object.fromEntries(meta),
    intervalSteps,
    distanceFrom,
  };

  return {
    sourceKey: `${sourceName ?? "?"}|${startAt.toISOString()}|${endAt.toISOString()}`,
    source: detectSource(sourceName, device),
    sourceName,
    sourceVersion: a.sourceVersion ?? null,
    device,
    startAt,
    endAt,
    durationS,
    distanceM,
    avgPaceSPerKm: distanceM && distanceM > 0 ? durationS / (distanceM / 1000) : null,
    avgHr: toNumber(hrAvg.value),
    maxHr: toNumber(hrMax.value),
    avgPowerW: toNumber(power.value),
    avgSpeedMps: toMps(speed.value, speed.unit),
    avgStrideM: toMeters(stride.value, stride.unit),
    avgVerticalOscCm: toCm(vo.value, vo.unit),
    avgGroundContactMs: toMs(gct.value, gct.unit),
    steps: steps === null ? null : Math.round(steps),
    cadenceSpm: steps !== null && durationS > 0 ? steps / (durationS / 60) : null,
    elevationGainM: elevationM(meta.get("HKElevationAscended")),
    temperatureC: temperatureC(meta.get("HKWeatherTemperature")),
    humidityPct: humidityPct(meta.get("HKWeatherHumidity")),
    isIndoor: bool01(meta.get("HKIndoorWorkout")),
    activeEnergyKcal: toKcal(energy.value, energy.unit),
    routeFile: routeFileOf(xml),
    raw,
  };
}

/** `<Record type="…VO2Max" …>` → lectura. */
export function parseVo2Record(tag: string): { measuredAt: Date; value: number; sourceName: string } | null {
  const a = parseAttrs(tag);
  const measuredAt = parseHealthDate(a.startDate);
  const value = toNumber(a.value);
  if (!measuredAt || value === null) return null;
  return { measuredAt, value, sourceName: a.sourceName ?? "" };
}
