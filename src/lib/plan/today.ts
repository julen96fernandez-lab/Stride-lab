/**
 * «Hoy» en Inicio cuando he puesto una sesión para hoy: manda lo mío («Hoy te toca: …, lo
 * pusiste tú») y la estimación de la app queda como nota. Con lesión abierta, se avisa igual.
 * Lógica pura, con pruebas.
 */
import { MINE_LABEL, mineDetail, type MineKind } from "./mine";
import { MINE_STATUS_LABEL, type MineStatus } from "./linking";

export interface TodayMine {
  id: string;
  kind: MineKind;
  distanceM: number | null;
  durationS: number | null;
  note: string | null;
  status: MineStatus;
}

export interface TodayFromMine {
  /** «Rodaje suave» o «Rodaje suave y calidad» */
  title: string;
  /** «lo pusiste tú · 8 km · 45 min» */
  sub: string;
  note: string | null;
  /** «Cumplida» / «Hecha, otro tipo» si ya corriste (vinculada) */
  done: string | null;
  /** aviso de lesión abierta (null si no hay) */
  injury: string | null;
  /** «La estimación de la app era: Descanso.» (si difiere) */
  appNote: string | null;
  kind: MineKind;
}

export function todayFromMine(mine: readonly TodayMine[], advice: { label: string }, openInjury: boolean): TodayFromMine | null {
  if (!mine.length) return null;
  const first = mine[0];
  const labels = mine.map((m, i) => (i === 0 ? MINE_LABEL[m.kind] : MINE_LABEL[m.kind].toLowerCase()));
  const title = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}` : labels[0];
  const detail = mine.length === 1 ? mineDetail(first) : null;
  const done = mine.find((m) => m.status === "cumplida" || m.status === "otra");
  const exigente = mine.some((m) => m.kind === "tirada_larga" || m.kind === "calidad");
  const rest = mine.every((m) => m.kind === "descanso");
  return {
    title,
    sub: `${mine.length > 1 ? "las pusiste tú" : "lo pusiste tú"}${detail ? ` · ${detail}` : ""}`,
    note: mine.length === 1 ? first.note : null,
    done: done ? MINE_STATUS_LABEL[done.status] : null,
    injury: openInjury
      ? rest
        ? "Tienes una lesión abierta: buen día para descansar."
        : exigente
        ? "Tienes una lesión abierta: una sesión exigente no es buena idea; si la haces, sin forzar y para si molesta."
        : "Tienes una lesión abierta: hazlo suave y para si molesta."
      : null,
    appNote: advice.label.toLowerCase() !== title.toLowerCase() ? `La estimación de la app era: ${advice.label}.` : null,
    kind: first.kind,
  };
}
