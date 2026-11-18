import Link from "next/link";
import type { RaceView } from "@/lib/db/queries";
import { RACE_DISTANCES, countdownText, fmtTime } from "@/lib/race/race";
import { RealismPill } from "./RaceForm";

const fmtDate = (ymd: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`));
export const raceDistanceLabel = (r: Pick<RaceView, "distanceKey" | "distanceM">) =>
  r.distanceKey !== "other" ? RACE_DISTANCES[r.distanceKey].label : `${(r.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} km`;
const paceOf = (s: number, m: number) => {
  const p = Math.round(s / (m / 1000));
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, "0")}`;
};

/** Cuenta atrás de la próxima carrera objetivo (Inicio y Plan). */
export function RaceCountdown({ race, compact = false }: { race: RaceView; compact?: boolean }) {
  return (
    <Link href={`/plan/carrera/${race.id}`} className="card card-hero flex flex-col gap-1 p-5" aria-label={`${race.name}: ${countdownText(race.days)}. Ver la carrera`}>
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">Carrera objetivo</div>
        {race.realism && <RealismPill r={race.realism} />}
      </div>
      <div className="relative mt-1 font-display text-[24px] leading-tight font-bold">{race.name}</div>
      <div className="relative text-[13px] text-fg-2 first-letter:uppercase">
        {fmtDate(race.date)}
        {race.startTime ? ` · ${race.startTime}` : ""} · {raceDistanceLabel(race)}
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-3">
        <span className="num text-[26px] text-lime-text">{countdownText(race.days)}</span>
        {!compact && (
          <span className="text-right text-[13px] text-fg-2">
            Objetivo <b className="num text-[17px] text-fg">{fmtTime(race.targetS)}</b>
            <br />
            {paceOf(race.targetS, race.distanceM)} /km
          </span>
        )}
      </div>
    </Link>
  );
}

/** Lista de carreras objetivo en Plan (la más próxima arriba, en grande). */
export function RacesBlock({ races }: { races: RaceView[] }) {
  const upcoming = races.filter((r) => r.days >= 0);
  const past = races.filter((r) => r.days < 0);
  const [next, ...rest] = upcoming;
  return (
    <>
      {next ? (
        <RaceCountdown race={next} />
      ) : (
        <section className="card p-5" aria-label="Carrera objetivo">
          <div className="eyebrow">Carrera objetivo</div>
          <p className="mt-2 text-[14px] text-fg-2">Sin carrera apuntada. Cuando la tengas, el plan de las semanas previas se adapta.</p>
        </section>
      )}
      {(rest.length > 0 || past.length > 0) && (
        <section className="card p-5" aria-label="Otras carreras objetivo">
          <div className="eyebrow">Otras carreras</div>
          <ul className="mt-1 divide-y divide-line">
            {[...rest, ...past].map((r) => (
              <li key={r.id}>
                <Link href={`/plan/carrera/${r.id}`} className="flex min-h-[52px] items-center justify-between gap-3 py-2">
                  <span>
                    <span className="block text-[15px] font-semibold">{r.name}</span>
                    <span className="block text-[12px] text-fg-2">
                      {raceDistanceLabel(r)} · {countdownText(r.days)}
                    </span>
                  </span>
                  <span className="num text-[15px]">{fmtTime(r.targetS)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href="/plan/carrera/nueva" className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong text-[15px] font-semibold text-fg-2">
        <span aria-hidden="true" className="text-[18px] leading-none">+</span> Apuntar una carrera objetivo
      </Link>
    </>
  );
}
