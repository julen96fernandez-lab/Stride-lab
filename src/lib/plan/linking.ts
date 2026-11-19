/**
 * Vinculación de mis sesiones con lo que corro de verdad. Lógica pura, con pruebas; se calcula
 * al leer (no se guarda nada), así que sobrevive a «Reprocesar».
 * - Cada sesión mía se vincula con una carrera del mismo día o de ±1 día; primero se reparten
 *   las del mismo día y luego las de al lado. A igualdad, la del tipo previsto y la más cercana.
 *   Una carrera solo vale para una sesión.
 * - Estado de mi sesión: «Cumplida» (vinculada y del tipo previsto: tirada larga → tirada larga;
 *   calidad → series, tempo o competición; suave u otro → cualquiera), «Hecha, otro tipo»,
 *   «Pendiente» (aún dentro del margen de ±1 día) o «No hecha».
 * - «Sesión no prevista»: una carrera que no vincula con ninguna sesión mía ni es la que cumple
 *   (o, si no hay del tipo, la primera de) la sugerencia visible de su semana. Ya cuenta para la
 *   alternancia de las semanas siguientes porque forma parte del historial de carreras.
 */
import { dayNum } from "./shifts";
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

export function linkMine<R extends LinkRun>(mine: readonly { id: string; date: string; kind: string }[], runs: readonly R[]): Map<string, R> {
  const out = new Map<string, R>();
  const used = new Set<string>();
  // Un descanso no se vincula con ninguna carrera.
  const sorted = mine.filter((m) => m.kind !== "descanso").sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const maxGap of [0, 1]) {
    for (const m of sorted) {
      if (out.has(m.id)) continue;
      const d = dayNum(m.date)!;
      const cands = runs
        .filter((r) => !used.has(r.id) && Math.abs(dayNum(r.date)! - d) <= maxGap)
        .sort((a, b) => Number(mineMatches(m.kind, b.type)) - Number(mineMatches(m.kind, a.type)) || Math.abs(dayNum(a.date)! - d) - Math.abs(dayNum(b.date)! - d) || a.at - b.at);
      if (cands[0]) {
        out.set(m.id, cands[0]);
        used.add(cands[0].id);
      }
    }
  }
  return out;
}

export function mineStatus(m: { date: string; kind: string }, run: LinkRun | null | undefined, today: string): MineStatus {
  if (m.kind === "descanso") return "descanso";
  if (run) return mineMatches(m.kind, run.type) ? "cumplida" : "otra";
  return dayNum(m.date)! + 1 >= dayNum(today)! ? "pendiente" : "no_hecha";
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
