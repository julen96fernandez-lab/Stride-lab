/**
 * Plan semanal: UNA sesión por semana con día recomendado y motivo en una línea. Lógica pura,
 * con pruebas. Reglas (acordadas):
 * - Tardes (trabajo L‑V): fin de semana, sábado (o domingo); aquí va la tirada larga.
 * - Mañanas (trabajo toda la semana, se corre tras el turno): un día entre semana por la tarde,
 *   calidad corta o rodaje suave; la tirada larga solo en fin de semana (aquí no se propone).
 * - Noches: rodaje suave opcional (solo si el sueño lo permite) o nada.
 * - Libre: la sesión exigente; la app elige el día y nunca el lunes que sigue a las noches.
 * - Nunca calidad el día después de una noche.
 * - Alterna tirada larga y calidad según la última sesión exigente (hecha o prevista); la libre
 *   que precede a las tardes es de calidad, porque las tardes llevan la tirada larga.
 * - Baja a rodaje suave: lesión abierta (todas las semanas), carga alta (ratio > 1,3) o más de
 *   3 semanas sin correr (solo la semana en curso: la carga futura no se conoce).
 */
import { afterNights, dayNum, weekdayOf, ymdOf, type ShiftKind, type ShiftWeek } from "./shifts";

export type SessionKind = "tirada_larga" | "calidad" | "calidad_corta" | "suave" | "suave_opcional";

export const SESSION_LABEL: Record<SessionKind, string> = {
  tirada_larga: "Tirada larga",
  calidad: "Calidad",
  calidad_corta: "Calidad corta",
  suave: "Rodaje suave",
  suave_opcional: "Rodaje suave (opcional)",
};

/** Sesiones que cuentan como «exigentes» para alternar. */
type Demanding = "long" | "quality";
const demandingOf = (k: SessionKind | string | null): Demanding | null =>
  k === "tirada_larga" ? "long" : k === "calidad" || k === "calidad_corta" || k === "series" || k === "tempo" || k === "competicion" ? "quality" : null;

export interface PastRun {
  /** día de calendario en Madrid, AAAA-MM-DD */
  date: string;
  /** tipo efectivo de la carrera */
  type: string | null;
}

export interface WeekSession {
  start: string;
  end: string;
  kind: ShiftKind;
  pos: number;
  session: SessionKind;
  label: string;
  /** día recomendado (AAAA-MM-DD) y en texto («sábado 28») */
  day: string;
  dayLabel: string;
  /** «por la tarde», «si has dormido bien»… */
  when: string | null;
  reason: string;
  /** se rebajó a suave por carga, lesión o parón */
  downgraded: boolean;
}

export const LOAD_HIGH = 1.3;
export const LONG_GAP_DAYS = 21;
const WD = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const fmtDay = (ymd: string) => {
  const d = dayNum(ymd)!;
  return `${WD[weekdayOf(d)]} ${Number(ymd.slice(8))}`;
};
const fmtDate = (ymd: string) => new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${ymd}T00:00:00Z`));

/** Primer día de `prefs` (0 = lunes) que no sea anterior a hoy y cumpla `ok`; si ninguno, el primero de `prefs`. */
function pickDay(w: ShiftWeek, prefs: number[], today: number, ok: (day: number) => boolean = () => true): number {
  const cands = prefs.map((p) => w.startDay + p).filter(ok);
  return cands.find((d) => d >= today) ?? cands.at(-1) ?? w.startDay + prefs[0];
}

export function planWeeks(o: {
  weeks: readonly ShiftWeek[];
  anchor: string;
  today: string;
  history: readonly PastRun[];
  /** ratio aguda/crónica actual (null sin historial suficiente) */
  ratio: number | null;
  openInjury: boolean;
}): WeekSession[] {
  const today = dayNum(o.today)!;
  const past = o.history.filter((r) => dayNum(r.date)! <= today).sort((a, b) => a.date.localeCompare(b.date));
  const lastRun = past.reduce<number | null>((m, r) => Math.max(m ?? -Infinity, dayNum(r.date)!), null);
  const lastDemandingRun = [...past].reverse().find((r) => demandingOf(r.type) !== null) ?? null;
  // La próxima exigente alterna con la última (hecha o prevista).
  let lastDemanding: Demanding | null = lastDemandingRun ? demandingOf(lastDemandingRun.type) : null;
  const lastTxt = lastDemandingRun ? `la última exigente fue ${lastDemanding === "long" ? "tirada larga" : "calidad"} el ${fmtDate(lastDemandingRun.date)}` : "sin sesiones exigentes recientes";

  return o.weeks.map((w, i) => {
    const current = i === 0 && today >= w.startDay && today <= w.startDay + 6;
    const noQualityOn = (d: number) => !afterNights(o.anchor, d);
    let session: SessionKind;
    let day: number;
    let when: string | null = null;
    let reason: string;

    if (w.kind === "noches") {
      session = "suave_opcional";
      day = pickDay(w, [5, 6, 2], today);
      when = "si has dormido bien";
      reason = "Semana de noches: solo si el sueño lo permite, suave o nada; nunca calidad tras una noche.";
    } else if (w.kind === "tardes") {
      session = "tirada_larga";
      day = pickDay(w, [5, 6], today);
      reason = "Semana de tardes: trabajas de lunes a viernes; el fin de semana, la tirada larga.";
    } else if (w.kind === "mananas") {
      const next: Demanding = lastDemanding === "quality" ? "long" : "quality";
      // La tirada larga no cabe entre semana: si «tocaría», suave; si toca calidad, corta.
      session = next === "quality" ? "calidad_corta" : "suave";
      day = pickDay(w, [2, 3, 1], today, noQualityOn);
      when = "por la tarde, tras el turno";
      reason =
        session === "calidad_corta"
          ? `Semana de mañanas: entre semana por la tarde, calidad corta (${i === 0 ? lastTxt : "alterna con la anterior"}).`
          : "Semana de mañanas: entre semana por la tarde, rodaje suave; la tirada larga, en una semana con fin de semana libre.";
    } else {
      // Libre: la exigente, alternando. Tras noches, nunca el lunes (ni calidad ese día).
      // La libre que precede a las tardes (5.ª del ciclo) es de calidad: las tardes llevan la tirada larga.
      const beforeTardes = w.pos === 4;
      const next: Demanding = beforeTardes ? "quality" : lastDemanding === "long" ? "quality" : "long";
      session = next === "long" ? "tirada_larga" : "calidad";
      const prefs = w.pos === 2 ? [2, 3, 5, 1] : [1, 2, 3, 5];
      day = pickDay(w, prefs, today, (d) => !afterNights(o.anchor, d));
      reason = `Semana libre${w.pos === 2 ? " tras noches (sin el lunes)" : ""}: la sesión exigente; toca ${next === "long" ? "tirada larga" : "calidad"} (${
        beforeTardes ? "la semana de tardes que viene lleva la tirada larga" : i === 0 ? lastTxt : "alterna con la anterior"
      }).`;
    }

    // Rebajas por prudencia.
    let downgraded = false;
    if (session !== "suave_opcional") {
      const cause = o.openInjury
        ? "lesión abierta"
        : current && o.ratio !== null && o.ratio > LOAD_HIGH
          ? `carga alta (ratio ${o.ratio.toFixed(2).replace(".", ",")})`
          : current && (lastRun === null || today - lastRun > LONG_GAP_DAYS)
            ? `más de ${LONG_GAP_DAYS / 7} semanas sin correr`
            : null;
      if (cause) {
        session = "suave";
        downgraded = true;
        reason = `Rodaje suave por ${cause}. ${reason.split(":")[0]}.`;
      }
    }
    const dem = demandingOf(session);
    if (dem) lastDemanding = dem;
    const ymd = ymdOf(day);
    return { start: w.start, end: w.end, kind: w.kind, pos: w.pos, session, label: SESSION_LABEL[session], day: ymd, dayLabel: fmtDay(ymd), when, reason, downgraded };
  });
}

export { fmtDay };
