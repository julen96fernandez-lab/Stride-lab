/**
 * Vinculación de lo previsto (mis sesiones y la sugerida de la semana) con lo que corro de verdad.
 * Lógica pura, con pruebas; se calcula al leer (no se guarda nada salvo los vínculos manuales),
 * así que sobrevive a «Reprocesar».
 * - Una carrera cubre como máximo una sesión. Reparto (cambio del 26‑nov‑2026, «por semana»):
 *   1. Vínculos manuales (mandan sobre todo lo demás; «Desvincular» deja la sesión sin carrera).
 *   2. Sesiones exigentes (tirada larga, calidad) con una carrera compatible: el mismo día, luego
 *      ±1 día y luego el resto de su semana (lunes a domingo). Compatible: tirada larga ↔ tirada
 *      larga; calidad ↔ series, tempo o competición.
 *   3. Suave, otro y sugerencias suaves con cualquier carrera, en el mismo orden.
 *   4. Una exigente sin carrera compatible se queda con una de otro tipo del mismo día o ±1 día
 *      («Hecha, otro tipo»), como antes.
 *   A igualdad, la del tipo previsto, la más cercana y la más temprana.
 * - Estado de mi sesión: «Cumplida», «Hecha, otro tipo», «Pendiente» (hasta el domingo de su
 *   semana, o el día siguiente si es domingo) o «No hecha».
 * - «Sesión no prevista»: una carrera que no cubre ninguna sesión mía ni es la que cumple
 *   (o, si no hay del tipo, la primera de) la sugerencia visible de su semana. Ya cuenta para la
 *   alternancia de las semanas siguientes porque forma parte del historial de carreras.
 */
import { dayNum, mondayOfDay, weekdayOf } from "./shifts";
import { matchesSession } from "./compliance";
import type { SessionKind } from "./weekly";

export type MineStatus = "cumplida" | "otra" | "pendiente" | "no_hecha" | "descanso";
export const MINE_STATUS_LABEL: Record<MineStatus, string> = {
  cumplida: "Cumplida",
  otra: "Hecha, otro tipo",
  pendiente: "Pendiente",
  no_hecha: "No hecha",
  descanso: "Descanso",
};

export interface LinkRun {
  id: string;
  /** día en Madrid, AAAA-MM-DD */
  date: string;
  /** inicio (ms), para desempatar */
  at: number;
  type: string | null;
}

/** Tipo de mi sesión → ¿le vale esta carrera? */
export function mineMatches(kind: string, runType: string | null): boolean {
  if (kind === "tirada_larga") return matchesSession("tirada_larga", runType);
  if (kind === "calidad") return matchesSession("calidad", runType);
  return true;
}

/** Sesión prevista que puede cubrirse con una carrera: mía (tipo de MineKind) o sugerida (SessionKind). */
export interface PlanSlot {
  id: string;
  /** día previsto (Madrid), AAAA-MM-DD */
  date: string;
  kind: string;
  /** vínculo manual: id de la carrera; `null` = «Desvincular» (sin carrera, sin cálculo automático) */
  manual?: string | null;
}
export interface SlotLink<R> {
  run: R;
  /** días de la carrera respecto al día previsto (negativo = hecha antes) */
  offset: number;
  manual: boolean;
}

const DEMANDING = new Set(["tirada_larga", "calidad", "calidad_corta"]);
export const isDemandingKind = (kind: string) => DEMANDING.has(kind);
/** ¿Esta carrera es del tipo de la sesión (mía o sugerida)? Suave, otro y opcionales: cualquiera. */
export function slotMatches(kind: string, runType: string | null): boolean {
  return DEMANDING.has(kind) ? matchesSession(kind as SessionKind, runType) : true;
}

/** Reparto de carreras entre las sesiones previstas (ver arriba). Un descanso no se vincula. */
export function assignRuns<R extends LinkRun>(slots: readonly PlanSlot[], runs: readonly R[]): Map<string, SlotLink<R>> {
  const out = new Map<string, SlotLink<R>>();
  const used = new Set<string>();
  const live = slots.filter((m) => m.kind !== "descanso");
  const link = (m: PlanSlot, r: R, manual: boolean) => {
    out.set(m.id, { run: r, offset: dayNum(r.date)! - dayNum(m.date)!, manual });
    used.add(r.id);
  };
  // 1. Manuales: mandan. `null` = desvinculada a mano (queda fuera del cálculo).
  const fixed = new Set<string>();
  for (const m of live) {
    if (m.manual === undefined) continue;
    fixed.add(m.id);
    const r = m.manual === null ? undefined : runs.find((x) => x.id === m.manual && !used.has(x.id));
    if (r) link(m, r, true);
  }
  const auto = live.filter((m) => !fixed.has(m.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const week = (ymd: string) => mondayOfDay(dayNum(ymd)!);
  const pick = (m: PlanSlot, gap: number, compatibleOnly: boolean) => {
    const d = dayNum(m.date)!;
    const cands = runs
      .filter((r) => {
        if (used.has(r.id)) return false;
        const dist = Math.abs(dayNum(r.date)! - d);
        const near = gap === Infinity ? week(r.date) === week(m.date) : dist <= gap;
        return near && (!compatibleOnly || slotMatches(m.kind, r.type));
      })
      .sort(
        (a, b) =>
          Number(slotMatches(m.kind, b.type)) - Number(slotMatches(m.kind, a.type)) ||
          Math.abs(dayNum(a.date)! - d) - Math.abs(dayNum(b.date)! - d) ||
          a.at - b.at,
      );
    if (cands[0]) link(m, cands[0], false);
  };
  const groups = [auto.filter((m) => DEMANDING.has(m.kind)), auto.filter((m) => !DEMANDING.has(m.kind))];
  for (const group of groups)
    for (const gap of [0, 1, Infinity]) for (const m of group) if (!out.has(m.id)) pick(m, gap, true);
  // 4. Exigentes sin carrera compatible: una de otro tipo del mismo día o ±1 («Hecha, otro tipo»).
  for (const gap of [0, 1]) for (const m of groups[0]) if (!out.has(m.id)) pick(m, gap, false);
  return out;
}

/** Mis sesiones solas (compatibilidad): sesión → carrera. */
export function linkMine<R extends LinkRun>(mine: readonly { id: string; date: string; kind: string }[], runs: readonly R[]): Map<string, R> {
  return new Map([...assignRuns(mine, runs)].map(([id, l]) => [id, l.run]));
}

export function mineStatus(m: { date: string; kind: string }, run: LinkRun | null | undefined, today: string): MineStatus {
  if (m.kind === "descanso") return "descanso";
  if (run) return mineMatches(m.kind, run.type) ? "cumplida" : "otra";
  // Pendiente mientras una carrera aún pueda cubrirla: hasta el domingo de su semana (o el lunes
  // siguiente si es domingo, por el margen de ±1 día).
  const d = dayNum(m.date)!;
  return Math.max(mondayOfDay(d) + 6, d + 1) >= dayNum(today)! ? "pendiente" : "no_hecha";
}

/**
 * Carreras no previstas: las que no vinculan con mis sesiones ni cumplen la sugerencia visible
 * de su semana (la primera del tipo sugerido; si no hay, la primera de la semana).
 */
export function unplannedRuns<R extends LinkRun>(
  runs: readonly R[],
  linked: ReadonlySet<string>,
  /** sugerencia visible por semana (lunes → sesión) */
  suggestions: ReadonlyMap<string, SessionKind>,
  weekOf: (ymd: string) => string,
): R[] {
  const covers = new Set<string>();
  const byWeek = new Map<string, R[]>();
  for (const r of [...runs].sort((a, b) => a.at - b.at)) {
    if (linked.has(r.id)) continue;
    const w = weekOf(r.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
  }
  for (const [w, rs] of byWeek) {
    const s = suggestions.get(w);
    if (!s) continue;
    const hit = rs.find((r) => matchesSession(s, r.type)) ?? rs[0];
    covers.add(hit.id);
  }
  return runs.filter((r) => !linked.has(r.id) && !covers.has(r.id));
}

const WEEKDAY = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
/** «jueves 26» */
export const runDayLabel = (ymd: string) => `${WEEKDAY[weekdayOf(dayNum(ymd)!)]} ${Number(ymd.slice(8))}`;
/**
 * Cuándo se hizo una sesión respecto a su día: «Hecha antes (jueves 26)», «Hecha después (lunes 23)»
 * o null si fue el mismo día (o no hay carrera).
 */
export function doneWhen(link: { offset: number; run: { date: string } } | null | undefined): string | null {
  if (!link || link.offset === 0) return null;
  return `Hecha ${link.offset < 0 ? "antes" : "después"} (${runDayLabel(link.run.date)})`;
}

// ─── Vínculo manual ─────────────────────────────────────────────────────────

export type LinkMode = "auto" | "manual" | "unlinked";

/**
 * Lo guardado de una sesión (o de la sugerencia de una semana) a lo que entiende `assignRuns`:
 * una carrera → vínculo manual; «Desvincular» → null (sin carrera); nada → cálculo automático.
 */
export function manualOf(row: { runId?: string | null; unlinked?: boolean | null }): string | null | undefined {
  if (row.runId) return row.runId;
  return row.unlinked ? null : undefined;
}
export const linkMode = (row: { runId?: string | null; unlinked?: boolean | null }): LinkMode => (row.runId ? "manual" : row.unlinked ? "unlinked" : "auto");

/**
 * Estado de la sugerencia de una semana con vínculo manual: con carrera, cumplida si es de su tipo
 * y «otra» si no; desvinculada, como si no se hubiera corrido nada (pendiente, día pasado…).
 * `undefined` = sin vínculo manual (se usa el cálculo por semana de siempre).
 */
export function manualWeekStatus(
  session: SessionKind,
  manual: string | null | undefined,
  linked: { type: string | null } | null | undefined,
  fallbackNoRuns: () => import("./compliance").WeekStatus,
): import("./compliance").WeekStatus | undefined {
  if (manual === undefined) return undefined;
  if (manual === null || !linked) return fallbackNoRuns();
  return slotMatches(session, linked.type) ? "cumplida" : "otra";
}
