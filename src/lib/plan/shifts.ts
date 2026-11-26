/**
 * Ciclo de turnos de 5 semanas (lunes a domingo): tardes → noches → libre → mañanas → libre.
 * Se ancla en el lunes en que empieza un bloque de tardes y se calcula hacia delante y hacia
 * atrás. Fechas como AAAA-MM-DD (días de calendario, sin horas: no le afectan husos ni cambios
 * de hora). Lógica pura, con pruebas.
 */
export type ShiftKind = "tardes" | "noches" | "libre" | "mananas";

export const CYCLE: readonly ShiftKind[] = ["tardes", "noches", "libre", "mananas", "libre"];
export const CYCLE_WEEKS = CYCLE.length;
export const isShiftKind = (k: unknown): k is ShiftKind => typeof k === "string" && (CYCLE as readonly string[]).includes(k);

export const SHIFT_META: Record<ShiftKind, { label: string; hint: string; color: string }> = {
  tardes: { label: "Tardes", hint: "Trabajas de lunes a viernes; corres el fin de semana.", color: "var(--t-tempo)" },
  noches: { label: "Noches", hint: "Solo si el sueño lo permite: suave o nada.", color: "var(--t-trail)" },
  libre: { label: "Libre", hint: "Sin trabajo: semana para la sesión exigente.", color: "var(--chart-line)" },
  mananas: { label: "Mañanas", hint: "Trabajas toda la semana; corres después del turno.", color: "var(--t-rodaje)" },
};

const DAY = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Número de día (desde 1970) de una fecha AAAA-MM-DD; null si no es una fecha real. */
export function dayNum(ymd: string): number | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t / DAY;
}

export const ymdOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
/** 0 = lunes … 6 = domingo */
export const weekdayOf = (day: number) => (new Date(day * DAY).getUTCDay() + 6) % 7;
export const mondayOfDay = (day: number) => day - weekdayOf(day);

export function isMonday(ymd: string): boolean {
  const d = dayNum(ymd);
  return d !== null && weekdayOf(d) === 0;
}

export interface ShiftWeek {
  /** lunes y domingo, AAAA-MM-DD */
  start: string;
  end: string;
  startDay: number;
  kind: ShiftKind;
  /** posición en el ciclo (0…4): distingue la primera libre (tras noches) de la segunda */
  pos: number;
  /** semanas desde el ancla (negativas hacia atrás) */
  offset: number;
}

/** Semana de turno que contiene `ymd`, según el lunes `anchor` de un bloque de tardes. */
export function shiftWeek(anchor: string, ymd: string): ShiftWeek {
  const a = dayNum(anchor);
  const d = dayNum(ymd);
  if (a === null || weekdayOf(a) !== 0) throw new Error("El inicio del bloque debe ser un lunes");
  if (d === null) throw new Error("Fecha no válida");
  const mon = mondayOfDay(d);
  const offset = Math.round((mon - a) / 7);
  const pos = ((offset % CYCLE_WEEKS) + CYCLE_WEEKS) % CYCLE_WEEKS;
  return { start: ymdOf(mon), end: ymdOf(mon + 6), startDay: mon, kind: CYCLE[pos], pos, offset };
}

/** `count` semanas desde la que contiene `fromYmd` (incluida). */
export function shiftWeeks(anchor: string, fromYmd: string, count: number): ShiftWeek[] {
  const first = shiftWeek(anchor, fromYmd);
  return Array.from({ length: count }, (_, i) => shiftWeek(anchor, ymdOf(first.startDay + 7 * i)));
}

/** Día anterior a `day` es de noche (último día de una semana de noches) → no calidad. */
export function afterNights(anchor: string, day: number): boolean {
  return weekdayOf(day) === 0 && shiftWeek(anchor, ymdOf(day - 1)).kind === "noches";
}

// ─── Cambios de turno de un día concreto ─────────────────────────────────────

/** Días con el turno cambiado (AAAA-MM-DD → turno), sobre el ciclo. */
export type ShiftOverrides = Readonly<Record<string, ShiftKind>>;

/** Turno efectivo de un día: el cambiado ese día o, si no, el de su bloque. */
export function shiftOn(anchor: string, ymd: string, ov?: ShiftOverrides | null): ShiftKind {
  return ov?.[ymd] ?? shiftWeek(anchor, ymd).kind;
}

/** Día de noche (turno efectivo): ese día solo suave u opcional. */
export const nightOn = (anchor: string, day: number, ov?: ShiftOverrides | null) => shiftOn(anchor, ymdOf(day), ov) === "noches";

/**
 * Día después de una noche: el día anterior fue de noche (turno efectivo) → nada exigente.
 * Sin cambios equivale a `afterNights` (el lunes que sigue a la semana de noches); con cambios,
 * un «Libre» dentro de una semana de noches solo queda libre si el día anterior no fue de noche.
 */
export const afterNightOn = (anchor: string, day: number, ov?: ShiftOverrides | null) => nightOn(anchor, day - 1, ov) && !nightOn(anchor, day, ov);

/** ¿Vale este día para una sesión exigente? (ni de noche ni tras una noche) */
export const demandingOkOn = (anchor: string, day: number, ov?: ShiftOverrides | null) => !nightOn(anchor, day, ov) && !nightOn(anchor, day - 1, ov);

/** Nombre de un día de turno (en singular). */
export const DAY_SHIFT_LABEL: Record<ShiftKind, string> = { mananas: "Mañana", tardes: "Tarde", noches: "Noche", libre: "Libre" };
