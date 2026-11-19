/**
 * Calendario de Plan: cuadrícula del mes (semanas de lunes a domingo) y marcas de cada día.
 * Lógica pura, con pruebas.
 * - Sesiones previstas por tipo (calidad, tirada larga, rodaje suave, otro); la sugerencia de la
 *   app se distingue de la «puesta por mí» (se pinta más tenue).
 * - ✓ con km si hay carrera hecha, 🏁 en la carrera objetivo y banda si hay lesión abierta.
 * - En semanas pasadas sin sugerencia guardada solo salen mis sesiones y las carreras hechas.
 */
import { dayNum, mondayOfDay, ymdOf, type ShiftKind } from "./shifts";
import { SESSION_LABEL, type SessionKind } from "./weekly";

export type CalKind = "calidad" | "tirada_larga" | "suave" | "otro" | "descanso";
export const CAL_KINDS: readonly CalKind[] = ["calidad", "tirada_larga", "suave", "otro", "descanso"];
export const CAL_LABEL: Record<CalKind, string> = { calidad: "Calidad", tirada_larga: "Tirada larga", suave: "Rodaje suave", otro: "Otro", descanso: "Descanso" };

/** Tipo del calendario de una sugerencia (la de «solo la carrera» no lleva punto: va el 🏁). */
export function calKindOfSuggestion(s: SessionKind): CalKind | null {
  if (s === "tirada_larga") return "tirada_larga";
  if (s === "calidad" || s === "calidad_corta") return "calidad";
  if (s === "solo_carrera") return null;
  return "suave";
}

export interface GridDay {
  ymd: string;
  /** día del mes */
  d: number;
  inMonth: boolean;
}
export interface GridWeek {
  /** lunes */
  start: string;
  days: GridDay[];
}

/** Semanas (lunes a domingo) que cubren el mes `month` (1–12) de `year`, con los días de los meses vecinos. */
export function monthGrid(year: number, month: number): GridWeek[] {
  const first = Date.UTC(year, month - 1, 1) / 86_400_000;
  const last = Date.UTC(year, month, 0) / 86_400_000;
  const weeks: GridWeek[] = [];
  for (let mon = mondayOfDay(first); mon <= last; mon += 7) {
    weeks.push({
      start: ymdOf(mon),
      days: Array.from({ length: 7 }, (_, i) => {
        const ymd = ymdOf(mon + i);
        return { ymd, d: Number(ymd.slice(8)), inMonth: mon + i >= first && mon + i <= last };
      }),
    });
  }
  return weeks;
}

/** Mes siguiente o anterior: { year, month } con month 1–12. */
export function addMonths(ym: { year: number; month: number }, n: number): { year: number; month: number } {
  const i = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** Primer lunes y último domingo de las cuadrículas de los meses [centro − n, centro + n]. */
export function blockRange(center: { year: number; month: number }, n = 3): { from: string; to: string } {
  const a = addMonths(center, -n);
  const b = addMonths(center, n);
  const ga = monthGrid(a.year, a.month);
  const gb = monthGrid(b.year, b.month);
  return { from: ga[0].start, to: gb.at(-1)!.days[6].ymd };
}

export interface DayPlan {
  kind: CalKind;
  /** puesta por mí (true) o sugerencia de la app (false) */
  mine: boolean;
  /** «Tirada larga», «Rodaje suave (opcional)»… */
  label: string;
  /** id de mi sesión */
  id?: string;
  /** «12 km · 1 h» (mi sesión) */
  detail?: string | null;
  note?: string | null;
  distanceM?: number | null;
  durationS?: number | null;
  /** choques con las reglas (mi sesión; se guarda igual) */
  warnings?: string[];
  /** sugerencia: su semana (lunes) y la sesión, para editarla o moverla */
  week?: string;
  session?: SessionKind;
}
export interface DayRun {
  id: string;
  km: number | null;
  type: string | null;
  paceS: number | null;
}
export interface DayCell {
  plans: DayPlan[];
  runs: DayRun[];
  race: string | null;
  injury: boolean;
}
export interface CalendarBlock {
  from: string;
  to: string;
  /** turno de cada semana (lunes → turno) */
  shifts: Record<string, ShiftKind>;
  /** solo los días con algo */
  days: Record<string, DayCell>;
}

export function buildCalendar(o: {
  from: string;
  to: string;
  /** turno de una semana por su lunes (null sin ciclo) */
  shiftOf: ((monday: string) => ShiftKind) | null;
  /** sugerencias visibles (no quitadas ni sustituidas): día y sesión */
  suggestions: readonly { day: string; session: SessionKind; week: string }[];
  mine: readonly { id: string; date: string; kind: string; detail?: string | null; note?: string | null; distanceM?: number | null; durationS?: number | null; warnings?: string[] }[];
  runs: readonly { id: string; date: string; distanceM: number | null; type?: string | null; paceS?: number | null }[];
  races: readonly { name: string; date: string }[];
  injuries: readonly { startDate: string; endDate: string | null }[];
  today: string;
}): CalendarBlock {
  const from = dayNum(o.from)!;
  const to = dayNum(o.to)!;
  const inRange = (ymd: string) => ymd >= o.from && ymd <= o.to;
  const days: Record<string, DayCell> = {};
  const cell = (ymd: string) => (days[ymd] ??= { plans: [], runs: [], race: null, injury: false });

  for (const s of o.suggestions) {
    const k = calKindOfSuggestion(s.session);
    if (k && inRange(s.day)) cell(s.day).plans.push({ kind: k, mine: false, label: SESSION_LABEL[s.session], week: s.week, session: s.session });
  }
  for (const m of o.mine) {
    if (!inRange(m.date)) continue;
    const k = (CAL_KINDS as readonly string[]).includes(m.kind) ? (m.kind as CalKind) : "otro";
    cell(m.date).plans.push({
      kind: k,
      mine: true,
      label: CAL_LABEL[k],
      id: m.id,
      detail: m.detail ?? null,
      note: m.note ?? null,
      distanceM: m.distanceM ?? null,
      durationS: m.durationS ?? null,
      warnings: m.warnings ?? [],
    });
  }
  for (const r of o.runs)
    if (inRange(r.date)) cell(r.date).runs.push({ id: r.id, km: r.distanceM === null ? null : Math.round(r.distanceM / 100) / 10, type: r.type ?? null, paceS: r.paceS ?? null });
  for (const r of o.races) if (inRange(r.date)) cell(r.date).race = r.name;
  // Lesión abierta (o cerrada) cubre sus días; una abierta llega hasta hoy.
  for (const i of o.injuries) {
    const a = Math.max(from, dayNum(i.startDate)!);
    const b = Math.min(to, dayNum(i.endDate ?? o.today)!);
    for (let d = a; d <= b; d++) cell(ymdOf(d)).injury = true;
  }
  // Mis sesiones primero (mandan), luego las sugerencias.
  for (const c of Object.values(days)) c.plans.sort((x, y) => Number(y.mine) - Number(x.mine));

  const shifts: Record<string, ShiftKind> = {};
  if (o.shiftOf) for (let mon = mondayOfDay(from); mon <= to; mon += 7) shifts[ymdOf(mon)] = o.shiftOf(ymdOf(mon));
  return { from: o.from, to: o.to, shifts, days };
}

/** Une dos bloques contiguos o solapados; en su rango manda el segundo (más reciente). */
export function mergeBlocks(a: CalendarBlock, b: CalendarBlock): CalendarBlock {
  const keepA = Object.fromEntries(Object.entries(a.days).filter(([ymd]) => ymd < b.from || ymd > b.to));
  return {
    from: a.from < b.from ? a.from : b.from,
    to: a.to > b.to ? a.to : b.to,
    shifts: { ...a.shifts, ...b.shifts },
    days: { ...keepA, ...b.days },
  };
}

/** ¿El bloque cubre la cuadrícula entera de ese mes? */
export function covers(block: { from: string; to: string }, year: number, month: number): boolean {
  const g = monthGrid(year, month);
  return block.from <= g[0].start && block.to >= g.at(-1)!.days[6].ymd;
}
