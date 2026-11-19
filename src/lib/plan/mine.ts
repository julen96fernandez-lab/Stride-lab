/**
 * Sesiones previstas puestas por mí en Plan. Lógica pura, con pruebas: formulario, tipos y
 * cómo se traduce una sugerencia (o la recomendación de «Hoy») a una sesión mía.
 * Lo que pongo manda sobre la sugerencia y se marca «Puesta por mí».
 */
import { dayNum, mondayOfDay, ymdOf } from "./shifts";
import type { SessionKind } from "./weekly";

/** «descanso»: el día marcado como de descanso (sin sesión; no cuenta para alternar ni se vincula). */
export type MineKind = "tirada_larga" | "calidad" | "suave" | "otro" | "descanso";
export const MINE_KINDS: readonly MineKind[] = ["calidad", "tirada_larga", "suave", "otro", "descanso"];
export const MINE_LABEL: Record<MineKind, string> = {
  tirada_larga: "Tirada larga",
  calidad: "Calidad",
  suave: "Rodaje suave",
  otro: "Otro",
  descanso: "Descanso",
};
export const isMineKind = (k: unknown): k is MineKind => typeof k === "string" && (MINE_KINDS as readonly string[]).includes(k);

export const MINE_NOTE_MAX = 200;
/** Desde 4 semanas atrás hasta un año adelante. */
export const MINE_PAST_DAYS = 28;
export const MINE_FUTURE_DAYS = 365;
export const MINE_KM: [number, number] = [0.5, 100];
export const MINE_MIN: [number, number] = [5, 6 * 60];

export interface MineInput {
  date: string;
  kind: MineKind;
  distanceM: number | null;
  durationS: number | null;
  note: string | null;
  replacesWeek: string | null;
}
export type MineErrors = Partial<Record<"date" | "kind" | "distance" | "duration" | "note", string>>;

/** Duración: «45» (minutos), «1:15» (h:mm) o «1:15:30» (h:mm:ss). Segundos o null si no vale. */
export function parseDuration(raw: string): number | null {
  const t = raw.trim().replace(/\s*(min|m)$/i, "");
  if (/^\d{1,3}$/.test(t)) return Number(t) * 60;
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/** «45 min», «1 h 15 min» */
export function fmtDuration(s: number): string {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** Para el campo del formulario: «45» o «1:15». */
export function durationField(s: number | null): string {
  if (s === null) return "";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : String(m);
}

export function parseMineForm(f: Record<string, string | undefined>, today: string): { input: MineInput | null; errors: MineErrors } {
  const errors: MineErrors = {};
  const date = (f.date ?? "").trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayNum(date) : null;
  const t = dayNum(today)!;
  if (d === null) errors.date = "Elige una fecha.";
  else if (d < t - MINE_PAST_DAYS) errors.date = `Como mucho ${MINE_PAST_DAYS / 7} semanas atrás.`;
  else if (d > t + MINE_FUTURE_DAYS) errors.date = "Como mucho un año adelante.";

  const kind = f.kind;
  if (!isMineKind(kind)) errors.kind = "Elige el tipo de sesión.";

  let distanceM: number | null = null;
  const km = (f.distanceKm ?? "").trim().replace(",", ".");
  if (km) {
    const n = Number(km);
    if (!Number.isFinite(n) || n < MINE_KM[0] || n > MINE_KM[1]) errors.distance = `Distancia entre ${String(MINE_KM[0]).replace(".", ",")} y ${MINE_KM[1]} km, o vacía.`;
    else distanceM = Math.round(n * 1000);
  }

  let durationS: number | null = null;
  const dur = (f.duration ?? "").trim();
  if (dur) {
    const s = parseDuration(dur);
    if (s === null || s < MINE_MIN[0] * 60 || s > MINE_MIN[1] * 60) errors.duration = "Duración en minutos (45) o h:mm (1:15), entre 5 min y 6 h, o vacía.";
    else durationS = s;
  }

  const note = (f.note ?? "").trim();
  if (note.length > MINE_NOTE_MAX) errors.note = `Como mucho ${MINE_NOTE_MAX} caracteres.`;

  const rw = (f.replacesWeek ?? "").trim();
  const rwDay = /^\d{4}-\d{2}-\d{2}$/.test(rw) ? dayNum(rw) : null;
  const replacesWeek = rwDay !== null && mondayOfDay(rwDay) === rwDay ? rw : null;

  if (Object.keys(errors).length) return { input: null, errors };
  // Un descanso no lleva distancia ni duración.
  const rest = kind === "descanso";
  return { input: { date, kind: kind as MineKind, distanceM: rest ? null : distanceM, durationS: rest ? null : durationS, note: note || null, replacesWeek }, errors };
}

/** ¿Vale esta fecha para una sesión mía? (de 4 semanas atrás a un año adelante) Mensaje o null. */
export function mineDateError(date: string, today: string): string | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayNum(date) : null;
  const t = dayNum(today)!;
  if (d === null) return "Elige una fecha.";
  if (d < t - MINE_PAST_DAYS) return `Como mucho ${MINE_PAST_DAYS / 7} semanas atrás.`;
  if (d > t + MINE_FUTURE_DAYS) return "Como mucho un año adelante.";
  return null;
}

/** Tipo mío equivalente a una sugerencia (para editarla). */
export function mineKindOf(s: SessionKind): MineKind {
  if (s === "tirada_larga") return "tirada_larga";
  if (s === "calidad" || s === "calidad_corta") return "calidad";
  return "suave";
}

/** «Voy a correr hoy»: el tipo que propone la recomendación de Hoy (ante la duda, suave). */
export function mineKindForToday(kind: "descanso" | "suave" | "calidad" | "libre"): MineKind {
  return kind === "calidad" ? "calidad" : "suave";
}

/** Lunes de la semana de una fecha. */
export const weekOf = (ymd: string) => ymdOf(mondayOfDay(dayNum(ymd)!));

/** «8 km · 45 min» (lo que haya), o null. */
export function mineDetail(m: { distanceM: number | null; durationS: number | null }): string | null {
  const parts = [
    m.distanceM !== null ? `${(m.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km` : null,
    m.durationS !== null ? fmtDuration(m.durationS) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
