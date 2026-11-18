/**
 * Previsto frente a realizado y «Reorganizar». Lógica pura, con pruebas.
 * - Cumplida: hay en la semana una carrera del tipo previsto (tirada larga → tirada larga;
 *   calidad → series, tempo o competición; suave → cualquier carrera).
 * - Otra sesión: se corrió, pero de otro tipo (sesión exigente prevista).
 * - Pendiente: aún no se ha corrido y el día previsto no ha pasado.
 * - Día pasado: el día previsto pasó sin correr y la semana sigue → se ofrece reorganizar.
 * - No cumplida: la semana acabó sin correr. Opcional (noches): sin correr no es un fallo.
 */
import { afterNights, dayNum, weekdayOf, ymdOf, type ShiftKind } from "./shifts";
import type { SessionKind } from "./weekly";

export type WeekStatus = "cumplida" | "otra" | "pendiente" | "dia_pasado" | "no_cumplida" | "opcional";

export const STATUS_LABEL: Record<WeekStatus, string> = {
  cumplida: "Cumplida",
  otra: "Otra sesión",
  pendiente: "Pendiente",
  dia_pasado: "Día pasado",
  no_cumplida: "No cumplida",
  opcional: "Opcional, sin correr",
};

const QUALITY = new Set(["series", "tempo", "competicion"]);

export function matchesSession(session: SessionKind, runType: string | null): boolean {
  if (session === "tirada_larga") return runType === "tirada_larga";
  if (session === "calidad" || session === "calidad_corta") return runType !== null && QUALITY.has(runType);
  return true; // suave: cuenta cualquier carrera
}

export function weekStatus(o: {
  session: SessionKind;
  day: string;
  weekStart: string;
  today: string;
  /** carreras de esa semana (lunes a domingo) */
  runs: readonly { date: string; type: string | null }[];
}): WeekStatus {
  const start = dayNum(o.weekStart)!;
  const end = start + 6;
  const today = dayNum(o.today)!;
  const inWeek = o.runs.filter((r) => {
    const d = dayNum(r.date)!;
    return d >= start && d <= end;
  });
  if (inWeek.some((r) => matchesSession(o.session, r.type))) return "cumplida";
  if (inWeek.length) return "otra";
  if (today > end) return o.session === "suave_opcional" ? "opcional" : "no_cumplida";
  if (o.session === "suave_opcional") return "pendiente";
  return today > dayNum(o.day)! ? "dia_pasado" : "pendiente";
}

/**
 * Nuevo día para una sesión cuyo día pasó, con las mismas reglas del turno: tardes solo fin de
 * semana; mañanas entre semana (por la tarde); libre cualquier día salvo el lunes tras noches;
 * nunca calidad el día después de una noche. Desde hoy (si hoy es válido) hasta el domingo.
 * null si no queda ningún día válido esta semana.
 */
export function rescheduleDay(o: { anchor: string; kind: ShiftKind; session: SessionKind; weekStart: string; today: string }): string | null {
  const start = dayNum(o.weekStart)!;
  const today = dayNum(o.today)!;
  const allowedWd = o.kind === "tardes" ? [5, 6] : o.kind === "mananas" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const quality = o.session === "calidad" || o.session === "calidad_corta";
  for (let d = Math.max(start, today); d <= start + 6; d++) {
    if (!allowedWd.includes(weekdayOf(d))) continue;
    if (afterNights(o.anchor, d) && (o.kind === "libre" || quality)) continue;
    return ymdOf(d);
  }
  return null;
}
