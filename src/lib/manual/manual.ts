/**
 * Carreras añadidas a mano (origen «Manual»): validación del formulario, valores calculados y
 * regla para que una carrera del zip de Salud las sustituya. Puro: lo usan el servidor y las
 * pruebas.
 */
import { MIN_VALID_DISTANCE_M, SPECIAL_PACE_S_PER_KM } from "@/lib/import/classify";
import { isSessionType, type SessionType } from "@/lib/analysis/session-type";

export interface ManualInput {
  startAt: Date;
  distanceM: number;
  durationS: number;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  cadenceSpm: number | null;
  avgPowerW: number | null;
  temperatureC: number | null;
  /** null = automático */
  sessionType: SessionType | null;
  note: string | null;
  isIndoor: boolean;
}

export type ManualErrors = Partial<Record<keyof ManualInput | "date" | "time" | "duration" | "file", string>>;

const TZ = "Europe/Madrid";

/** "10,5" o "10.5" → 10.5; vacío → null; texto → NaN. */
export function parseNum(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Fecha y hora locales de Madrid ("2026-11-15", "08:30") → instante. */
export function madridToDate(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Desfase de Madrid en ese momento (con cambio de hora).
  const offset = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
  };
  const ms = guess - offset(guess - offset(guess));
  const out = new Date(ms);
  return Number.isNaN(out.getTime()) || out.getUTCDate() === undefined ? null : out;
}

/** Instante → fecha y hora locales de Madrid para el formulario. */
export function dateToMadrid(d: Date): { date: string; time: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

/** Lee y valida el formulario. Devuelve los datos o los errores, campo a campo, en español. */
export function parseManualForm(f: Record<string, string | undefined>, now: Date = new Date()): { input: ManualInput | null; errors: ManualErrors } {
  const errors: ManualErrors = {};
  const startAt = madridToDate(f.date ?? "", f.time ?? "");
  if (!startAt) errors.date = "Indica la fecha y la hora de inicio.";
  else if (startAt.getTime() > now.getTime() + 60 * 60 * 1000) errors.date = "La fecha de inicio está en el futuro.";

  const km = parseNum(f.distanceKm);
  if (km === null || Number.isNaN(km) || km <= 0) errors.distanceM = "Indica la distancia en km (por ejemplo 10,5).";
  else if (km > 300) errors.distanceM = "La distancia no puede pasar de 300 km.";

  const h = parseNum(f.h) ?? 0;
  const m = parseNum(f.m) ?? 0;
  const sec = parseNum(f.s) ?? 0;
  const durationS = h * 3600 + m * 60 + sec;
  if ([h, m, sec].some((x) => Number.isNaN(x) || x < 0) || m >= 60 || sec >= 60 || h > 48) errors.duration = "Revisa la duración: horas, minutos (0–59) y segundos (0–59).";
  else if (!(durationS > 0)) errors.duration = "Indica la duración (h:min:s).";

  if (!errors.distanceM && !errors.duration && km) {
    const pace = durationS / km;
    if (pace < 90) errors.duration = "Ritmo imposible (más rápido de 1:30 /km): revisa la distancia y la duración.";
    else if (pace > 60 * 60) errors.duration = "Ritmo de más de 60:00 /km: revisa la distancia y la duración.";
  }

  const opt = (key: keyof ManualInput, raw: string | undefined, min: number, max: number, msg: string) => {
    const v = parseNum(raw);
    if (v === null) return null;
    if (Number.isNaN(v) || v < min || v > max) {
      errors[key] = msg;
      return null;
    }
    return v;
  };
  const avgHr = opt("avgHr", f.avgHr, 30, 230, "Pulso medio entre 30 y 230 ppm.");
  const maxHr = opt("maxHr", f.maxHr, 30, 250, "Pulso máximo entre 30 y 250 ppm.");
  if (avgHr !== null && maxHr !== null && maxHr < avgHr) errors.maxHr = "El pulso máximo no puede ser menor que el medio.";
  const elevationGainM = opt("elevationGainM", f.elevationGainM, 0, 10000, "Desnivel positivo entre 0 y 10 000 m.");
  const cadenceSpm = opt("cadenceSpm", f.cadenceSpm, 60, 260, "Cadencia entre 60 y 260 pasos/min.");
  const avgPowerW = opt("avgPowerW", f.avgPowerW, 30, 1000, "Potencia media entre 30 y 1000 W.");
  const temperatureC = opt("temperatureC", f.temperatureC, -30, 55, "Temperatura entre −30 y 55 °C.");
  const st = (f.sessionType ?? "auto").trim();
  if (st !== "auto" && !isSessionType(st)) errors.sessionType = "Tipo de sesión no válido.";
  const note = (f.note ?? "").trim();
  if (note.length > 500) errors.note = "La nota no puede pasar de 500 caracteres.";

  if (Object.keys(errors).length) return { input: null, errors };
  return {
    input: {
      startAt: startAt!,
      distanceM: Math.round(km! * 1000 * 10) / 10,
      durationS,
      avgHr,
      maxHr,
      elevationGainM,
      cadenceSpm,
      avgPowerW,
      temperatureC,
      sessionType: st === "auto" ? null : (st as SessionType),
      note: note || null,
      isIndoor: f.isIndoor === "on" || f.isIndoor === "true",
    },
    errors,
  };
}

export interface ManualDerived {
  paceSPerKm: number;
  isSpecial: boolean;
  status: "valid" | "invalid";
  invalidReason: string | null;
}

/** Ritmo medio, sesión especial y validez, con las mismas reglas que las importadas. */
export function manualDerived(input: Pick<ManualInput, "distanceM" | "durationS">): ManualDerived {
  const paceSPerKm = input.durationS / (input.distanceM / 1000);
  const invalid = input.distanceM < MIN_VALID_DISTANCE_M;
  return {
    paceSPerKm,
    isSpecial: paceSPerKm > SPECIAL_PACE_S_PER_KM,
    status: invalid ? "invalid" : "valid",
    invalidReason: invalid ? "menos_de_0_5_km" : null,
  };
}

// ─── Duplicados y sustitución por el zip ─────────────────────────────────────

/** Aviso de posible duplicado al guardar: otra carrera que empieza a ≤ 30 min. */
export const DUPLICATE_WARN_MS = 30 * 60 * 1000;

/** Regla para que una carrera del zip sustituya a una manual. */
export const REPLACE_WINDOW_MS = 30 * 60 * 1000;
export const REPLACE_DISTANCE_TOL = 0.05;

export interface RunLite {
  id: string;
  startAt: Date;
  distanceM: number | null;
}

const madridDay = (d: Date) => dateToMadrid(d).date;

/**
 * ¿La carrera del zip `z` es la misma que la manual `m`? Mismo día (Madrid), inicio a menos
 * de 30 min y distancia dentro de un 5 %.
 */
export function isSameRun(m: RunLite, z: RunLite): boolean {
  if (m.distanceM === null || z.distanceM === null || m.distanceM <= 0) return false;
  if (madridDay(m.startAt) !== madridDay(z.startAt)) return false;
  if (Math.abs(m.startAt.getTime() - z.startAt.getTime()) >= REPLACE_WINDOW_MS) return false;
  return Math.abs(z.distanceM - m.distanceM) / m.distanceM <= REPLACE_DISTANCE_TOL;
}

/** Pareja del zip para cada manual (la de inicio más cercano); cada carrera del zip, una vez. */
export function matchManualRuns(manual: readonly RunLite[], zip: readonly RunLite[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const m of [...manual].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    let best: RunLite | null = null;
    for (const z of zip) {
      if (used.has(z.id) || !isSameRun(m, z)) continue;
      if (!best || Math.abs(z.startAt.getTime() - m.startAt.getTime()) < Math.abs(best.startAt.getTime() - m.startAt.getTime())) best = z;
    }
    if (best) {
      out.set(m.id, best.id);
      used.add(best.id);
    }
  }
  return out;
}
