/**
 * Pasos de un entrenamiento de intervalos del Apple Watch (WorkoutEvent con la metadata
 * WOIntervalStepKeyPath = "bloque.repetición.fase"). Se guarda la hora de inicio y la
 * duración de cada paso para poder separar trabajo y recuperación.
 */
import { parseAttrs, parseHealthDate } from "./xml";
import { toSeconds } from "./units";

export interface IntervalEvent {
  key: string;
  /** s desde el inicio del entrenamiento */
  startS: number;
  durationS: number;
}

export function intervalEvents(xml: string, startMs: number, endMs: number): IntervalEvent[] {
  const re = /<WorkoutEvent\b([^>]*?)(?:\/>|>([\s\S]*?)<\/WorkoutEvent>)/g;
  const found: { key: string; startS: number; durationS: number | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const a = parseAttrs(`<WorkoutEvent ${m[1]}>`);
    const body = m[2] ?? "";
    const key = /<MetadataEntry\b[^>]*key="WOIntervalStepKeyPath"[^>]*value="([^"]+)"/.exec(body)?.[1];
    if (!key) continue;
    const d = parseHealthDate(a.date);
    if (!d) continue;
    const dur = a.duration !== undefined ? toSeconds(a.duration, a.durationUnit ?? "min") : null;
    found.push({ key, startS: (d.getTime() - startMs) / 1000, durationS: dur !== null && dur > 0 ? dur : null });
  }
  // Exports recientes: cada paso puede ser también un WorkoutActivity con sus fechas.
  const ra = /<WorkoutActivity\b([^>]*?)>([\s\S]*?)<\/WorkoutActivity>/g;
  while ((m = ra.exec(xml))) {
    const key = /<MetadataEntry\b[^>]*key="WOIntervalStepKeyPath"[^>]*value="([^"]+)"/.exec(m[2])?.[1];
    if (!key) continue;
    const a = parseAttrs(`<WorkoutActivity ${m[1]}>`);
    const d0 = parseHealthDate(a.startDate);
    const d1 = parseHealthDate(a.endDate);
    if (!d0) continue;
    // Las fechas de la actividad son más precisas: van delante.
    found.unshift({ key, startS: (d0.getTime() - startMs) / 1000, durationS: d1 ? (d1.getTime() - d0.getTime()) / 1000 : null });
  }
  // Orden estable: por inicio y, a igual inicio, primero las actividades (añadidas delante).
  found.sort((x, y) => x.startS - y.startS);
  // Un paso por clave (el reloj puede repetir el evento como segmento y como vuelta).
  const seen = new Set<string>();
  const uniq = found.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  const total = (endMs - startMs) / 1000;
  return uniq.map((e, i) => {
    const next = uniq[i + 1]?.startS ?? total;
    const durationS = e.durationS ?? Math.max(0, next - e.startS);
    return { key: e.key, startS: Math.round(e.startS * 10) / 10, durationS: Math.round(durationS * 10) / 10 };
  });
}

/**
 * Pausas del reloj (WorkoutEvent Pause/Resume y MotionPaused/MotionResumed), en s desde el
 * inicio. Una pausa sin reanudación llega hasta el final del entrenamiento.
 */
export function pauseEvents(xml: string, startMs: number, endMs: number): { startS: number; endS: number }[] {
  const re = /<WorkoutEvent\b([^>]*?)(?:\/>|>[\s\S]*?<\/WorkoutEvent>)/g;
  const ev: { t: number; on: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const a = parseAttrs(`<WorkoutEvent ${m[1]}>`);
    const type = a.type ?? "";
    const pause = type === "HKWorkoutEventTypePause" || type === "HKWorkoutEventTypeMotionPaused";
    const resume = type === "HKWorkoutEventTypeResume" || type === "HKWorkoutEventTypeMotionResumed";
    if (!pause && !resume) continue;
    const d = parseHealthDate(a.date);
    if (d) ev.push({ t: (d.getTime() - startMs) / 1000, on: pause });
  }
  ev.sort((x, y) => x.t - y.t);
  const out: { startS: number; endS: number }[] = [];
  let open: number | null = null;
  for (const e of ev) {
    if (e.on && open === null) open = e.t;
    else if (!e.on && open !== null) {
      if (e.t > open) out.push({ startS: Math.round(open), endS: Math.round(e.t) });
      open = null;
    }
  }
  if (open !== null) out.push({ startS: Math.round(open), endS: Math.round((endMs - startMs) / 1000) });
  return out;
}
