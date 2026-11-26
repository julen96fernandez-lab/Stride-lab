import Link from "next/link";
import type { WeekRow } from "@/lib/db/queries";

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", ...o }).format(new Date(`${ymd}T00:00:00Z`));
const km1 = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 1 });
/** «16–22 nov» o «28 dic – 3 ene» */
export const weekRange = (a: string, b: string) =>
  a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: "numeric" })}–${fmt(b, { day: "numeric", month: "short" })}` : `${fmt(a, { day: "numeric", month: "short" })} – ${fmt(b, { day: "numeric", month: "short" })}`;
const TONE = { good: "var(--load-low)", watch: "var(--load-mod)", neutral: "var(--fg-3)" } as const;

/** Inicio: la semana pasada en una tarjeta (sin avisos: solo al abrir la app). */
export function LastWeekCard({ w }: { w: WeekRow }) {
  return (
    <section className="card p-5" aria-label="Semana pasada">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">Semana pasada · {weekRange(w.start, w.end)}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="num text-[28px]">{km1(w.km)}</span> <span className="text-[12px] text-fg-2">km</span>
        </span>
        <span className="text-[13px] text-fg-2">{w.runs === 1 ? "1 carrera" : `${w.runs} carreras`}</span>
        {w.planTotal > 0 && (
          <span className="text-[13px] text-fg-2">
            {w.planDone} de {w.planTotal} previstas cumplidas
          </span>
        )}
      </div>
      {w.lines.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {w.lines.slice(0, 2).map((l) => (
            <li key={l.text} className="flex gap-2 text-[13px] leading-snug">
              <span className="mt-[6px] h-2 w-2 flex-none rounded-full" style={{ background: TONE[l.tone] }} aria-hidden="true" />
              {l.text}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/analisis/semana/${w.start}`} className="mt-3 flex min-h-[44px] items-center justify-center rounded-2xl border border-line-strong text-[14px] font-semibold">
        Ver el resumen de la semana
      </Link>
    </section>
  );
}

/** Análisis: las 12 últimas semanas, cada una enlaza a su resumen. */
export function WeeksHistory({ weeks }: { weeks: WeekRow[] }) {
  if (!weeks.length) return null;
  const max = Math.max(1, ...weeks.map((w) => w.km));
  return (
    <section id="semanas" className="card scroll-mt-6 p-5" aria-label="Últimas 12 semanas">
      <div className="eyebrow">Últimas 12 semanas</div>
      <p className="mt-1 text-[12px] text-fg-2">Toca una semana para ver su resumen: cifras, frases y previsto frente a realizado.</p>
      <ul className="mt-2 divide-y divide-line">
        {weeks.map((w) => (
          <li key={w.start}>
            <Link href={`/analisis/semana/${w.start}`} className="flex min-h-[52px] items-center gap-3 py-2">
              <span className="w-[96px] flex-none text-[12px] min-[360px]:w-[104px] min-[360px]:text-[13px]">
                <span className="block font-semibold">{weekRange(w.start, w.end)}</span>
                <span className="block text-[11px] text-fg-2">{w.inProgress ? "en curso" : fmt(w.start, { year: "numeric" })}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="h-2 rounded-full" style={{ width: `${Math.max(w.km > 0 ? 4 : 0, (w.km / max) * 100)}%`, background: w.inProgress ? "color-mix(in srgb, var(--lime) 55%, transparent)" : "var(--lime)" }} aria-hidden="true" />
                  <span className="num flex-none text-[13px]">{km1(w.km)} km</span>
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-fg-2">
                  <span className="whitespace-nowrap">{w.runs === 1 ? "1 carrera" : `${w.runs} carreras`}</span>
                  {w.planTotal > 0 && <span className="whitespace-nowrap">· {w.planDone}/{w.planTotal} previstas</span>}
                  {w.goalPct !== null && <span className="whitespace-nowrap">· objetivo {Math.round(w.goalPct * 100)}{"\u00a0"}%</span>}
                </span>
              </span>
              <span className="text-fg-3" aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
