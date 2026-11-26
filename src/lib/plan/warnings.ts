/**
 * Avisos de una sesión puesta por mí: si choca con una regla, se dice el motivo, pero se puede
 * guardar igual (mis sesiones nunca se mueven). Lógica pura, con pruebas. Reglas:
 * - Turno efectivo de cada día (el del ciclo o el cambiado ese día): en un día de noche, solo
 *   suave u opcional; tras una noche (el día anterior de noche), nada exigente.
 * - Una semana con la exigente ya corrida: «Ya hiciste la exigente de esta semana (…)» si pongo otra
 *   (salvo que esa carrera sea justo la que cubre la sesión).
 * - Nunca dos exigentes en días consecutivos (con otra mía, la sugerida o una ya corrida).
 * - Nunca el mismo tipo exigente dos veces seguidas (con la exigente anterior, mía, sugerida o hecha).
 * - Afinado de una carrera objetivo: dos semanas antes, nada de tirada larga; la semana anterior,
 *   solo suave; la semana de la carrera, solo un rodaje suave corto y no en los 2 días previos.
 */
import { afterNightOn, dayNum, mondayOfDay, nightOn, type ShiftOverrides } from "./shifts";
import { RACE_GAP_DAYS, demandingOf, fmtDay, type Demanding } from "./weekly";

export interface Exigente {
  date: string;
  kind: Demanding;
  /** «tu calidad», «la tirada larga sugerida», «la tirada larga que corriste» */
  what: string;
  /** id de mi sesión (para no compararla consigo misma) */
  id?: string;
  /** id de la carrera, si es una exigente ya corrida */
  runId?: string;
}

export interface WarnCtx {
  anchor: string | null;
  /** días con el turno cambiado (las reglas usan el turno efectivo de cada día) */
  overrides?: ShiftOverrides;
  races: readonly { name: string; date: string }[];
  /** otras sesiones exigentes: mías, sugeridas visibles y corridas */
  exigentes: readonly Exigente[];
  /** carrera que cubre cada sesión mía (id de sesión → id de carrera), según el reparto por semana */
  covering?: Readonly<Record<string, string>>;
}

const NAME: Record<Demanding, string> = { long: "tirada larga", quality: "calidad" };

export function mineWarnings(m: { id?: string; date: string; kind: string }, ctx: WarnCtx): string[] {
  const out: string[] = [];
  const d = dayNum(m.date);
  if (d === null) return out;
  const dem = demandingOf(m.kind);
  const others = ctx.exigentes.filter((e) => !(m.id && e.id === m.id));

  if (ctx.anchor && dem) {
    const ov = ctx.overrides;
    if (nightOn(ctx.anchor, d, ov)) out.push(ov?.[m.date] === "noches" ? "Día de noche (turno cambiado): solo rodaje suave u opcional." : "Semana de noches: solo rodaje suave u opcional.");
    else if (afterNightOn(ctx.anchor, d, ov)) out.push("Tras una noche: nada exigente ese día (regla de turnos).");
  }

  if (dem) {
    // La exigente de esta semana ya está hecha (otra carrera que no es la que cubre esta sesión).
    const own = m.id ? ctx.covering?.[m.id] : undefined;
    const wk = mondayOfDay(d);
    const done = others
      .filter((e) => e.runId && e.runId !== own && e.date !== m.date && mondayOfDay(dayNum(e.date)!) === wk)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (done) out.push(`Ya hiciste la exigente de esta semana (${fmtDay(done.date)}).`);
    const next = others.filter((e) => Math.abs(dayNum(e.date)! - d) === 1);
    if (next.length) out.push(`Dos exigentes en días seguidos: ${next[0].what} del ${fmtDay(next[0].date)}.`);
    const before = others.filter((e) => e.date < m.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (before && before.kind === dem) out.push(`Repite ${NAME[dem]}: la exigente anterior es ${before.what} del ${fmtDay(before.date)}; toca alternar.`);
  }

  // Afinado: la carrera más próxima en o después del día.
  const race = [...ctx.races].filter((r) => r.date >= m.date).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (race) {
    const rd = dayNum(race.date)!;
    const weeks = Math.round((mondayOfDay(rd) - mondayOfDay(d)) / 7);
    if (d === rd) out.push(`Es el día de la carrera (${race.name}).`);
    else if (weeks === 0) {
      if (dem) out.push(`Semana de la carrera (${race.name}): solo un rodaje suave corto.`);
      if (rd - d < RACE_GAP_DAYS) out.push(`A menos de ${RACE_GAP_DAYS} días de la carrera (${race.name}): mejor descansar.`);
    } else if (weeks === 1 && dem) out.push(`Semana anterior a la carrera (${race.name}): solo rodaje suave.`);
    else if (weeks === 2 && dem === "long") out.push(`Dos semanas antes de la carrera (${race.name}): calidad corta, no tirada larga.`);
  }
  return out;
}

export const MINE_WHAT: Record<string, string> = { tirada_larga: "tu tirada larga", calidad: "tu calidad" };
export const SUGG_WHAT: Record<Demanding, string> = { long: "la tirada larga sugerida", quality: "la calidad sugerida" };
export const RUN_WHAT: Record<Demanding, string> = { long: "la tirada larga que corriste", quality: "la calidad que corriste" };
