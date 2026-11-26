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
  /** aviso de turnos (noche hoy o ayer) si lo que puse es exigente; se mantiene igual */
  shiftWarning: string | null;
  kind: MineKind;
}

export function todayFromMine(
  mine: readonly TodayMine[],
  advice: { label: string },
  openInjury: boolean,
  shift?: { night: boolean; afterNight: boolean } | null,
): TodayFromMine | null {
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
    shiftWarning:
      exigente && shift?.night
        ? "Hoy tienes noche: la regla es solo suave u opcional (lo dejo como lo pusiste)."
        : exigente && shift?.afterNight
          ? "Ayer tuviste noche: la regla es nada exigente hoy (lo dejo como lo pusiste)."
          : null,
    kind: first.kind,
  };
}

/** Mi sesión de hoy con lo que la cubrió (reparto por semana, como en Plan). */
export interface TodayMineDone extends TodayMine {
  /** días de la carrera respecto a hoy (negativo = la corrí antes) */
  doneOffset?: number | null;
  done?: { dayLabel: string; typeLabel: string; km: string | null } | null;
}

/**
 * Separa mis sesiones de hoy: las que siguen pendientes (o las corrí hoy) y las que ya cubrió una
 * carrera anterior de su semana. De estas, una frase para «Hoy»: «Tu tirada larga de esta semana
 * ya está hecha: martes 24 (Tirada larga · 16 km).»
 */
export function splitToday<T extends TodayMineDone>(mine: readonly T[]): { pending: T[]; doneBefore: string[] } {
  const before = (m: T) => (m.status === "cumplida" || m.status === "otra") && m.doneOffset != null && m.doneOffset < 0 && !!m.done;
  return {
    pending: mine.filter((m) => !before(m)),
    doneBefore: mine.filter(before).map((m) => {
      const d = m.done!;
      const what = `${d.typeLabel}${d.km ? ` · ${d.km} km` : ""}`;
      const name = MINE_LABEL[m.kind].toLowerCase();
      return m.status === "cumplida"
        ? `Tu ${name} de esta semana ya está hecha: ${d.dayLabel} (${what}).`
        : `Tu ${name} de esta semana ya la cubrió otra sesión: ${d.dayLabel} (${what}).`;
    }),
  };
}
