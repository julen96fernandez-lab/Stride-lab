import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { WeekSkeleton } from "@/components/ui/Skeletons";
import { weekScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { addDaysYmd, mondayOf } from "@/lib/analysis/week-dates";
import type { PlanState, Tone, WeekLine } from "@/lib/analysis/week-summary";

export const metadata = { title: "Resumen de la semana · Stride Lab" };

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", ...o }).format(new Date(`${ymd}T00:00:00Z`));
const km1 = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const time = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
};
/** «16–22 nov» o «28 dic – 3 ene» */
const range = (a: string, b: string) =>
  a.slice(0, 7) === b.slice(0, 7) ? `${fmt(a, { day: "numeric" })}–${fmt(b, { day: "numeric", month: "short" })}` : `${fmt(a, { day: "numeric", month: "short" })} – ${fmt(b, { day: "numeric", month: "short" })}`;

export default function WeekPage({ params }: { params: Promise<{ inicio: string }> }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/analisis#semanas" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Análisis
      </Link>
      <Suspense fallback={<WeekSkeleton />}>
        <WeekData params={params} />
      </Suspense>
    </div>
  );
}

const TONE: Record<Tone, string> = { good: "var(--load-low)", watch: "var(--load-mod)", neutral: "var(--fg-3)" };
const STATE: Record<PlanState, { label: string; color: string }> = {
  cumplida: { label: "✓ Cumplida", color: "var(--load-low)" },
  otra: { label: "Otro tipo", color: "var(--load-mod)" },
  pendiente: { label: "Pendiente", color: "var(--fg-2)" },
  dia_pasado: { label: "Día pasado", color: "var(--load-mod)" },
  no_hecha: { label: "✕ Sin hacer", color: "var(--load-high)" },
  no_cumplida: { label: "✕ Sin hacer", color: "var(--load-high)" },
  opcional: { label: "Opcional", color: "var(--fg-3)" },
  descanso: { label: "Descanso", color: "var(--fg-3)" },
};

async function WeekData({ params }: { params: Promise<{ inicio: string }> }) {
  await connection();
  const { inicio } = await params;
  const today = cacheDay();
  const current = mondayOf(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || Number.isNaN(Date.parse(`${inicio}T00:00:00Z`)) || mondayOf(inicio) !== inicio || inicio > current) notFound();
  const report = await weekScreen(inicio, today);
  if (!report) notFound();
  const { summary: s, plan, runs } = report;
  const prev = addDaysYmd(inicio, -7);
  const next = addDaysYmd(inicio, 7);
  const maxDay = Math.max(1, ...s.daily);

  return (
    <div className="flex flex-col gap-4">
      {/* Cabecera con semana anterior / siguiente */}
      <header className="flex items-center justify-between gap-2">
        <Link href={`/analisis/semana/${prev}`} aria-label="Semana anterior" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-2 hover:bg-ov-2">
          <Chevron dir="left" />
        </Link>
        <div className="min-w-0 text-center">
          <h1 className="text-[20px] font-semibold">Semana {range(s.start, s.end)}</h1>
          <div className="text-[12px] text-fg-2">
            {fmt(s.start, { year: "numeric" })}
            {s.inProgress ? ` · en curso (${s.daysLeft === 1 ? "queda hoy" : `quedan ${s.daysLeft} días`})` : ""}
          </div>
        </div>
        {next <= current ? (
          <Link href={`/analisis/semana/${next}`} aria-label="Semana siguiente" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-2 hover:bg-ov-2">
            <Chevron dir="right" />
          </Link>
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        )}
      </header>

      {/* Frases */}
      <section className="card p-5" aria-label="Resumen">
        <div className="eyebrow">Resumen</div>
        <Lines lines={s.lines} />
        <p className="mt-3 text-[11px] leading-snug text-fg-3">Con reglas a partir de tus datos. Dice lo que coincidió, no las causas. Verde: bien; ámbar: a tener en cuenta.</p>
      </section>

      {/* Cifras */}
      <section className="card p-5" aria-label="Cifras de la semana">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="Distancia" value={km1(s.km)} unit="km" />
          <Stat label="Carreras" value={String(s.runs)} />
          <Stat label="Tiempo" value={s.runs ? time(s.timeS) : "—"} />
          <Stat label="Carga" value={s.load === null ? "—" : String(Math.round(s.load))} note={s.load !== null && s.loadRuns < s.runs ? `${s.loadRuns} de ${s.runs} con dato` : undefined} />
          <Stat label="Media 8 semanas anteriores" value={s.avgKm === null ? "—" : km1(s.avgKm)} unit={s.avgKm === null ? undefined : "km"} />
          <Stat label="Objetivo semanal" value={s.goal ? `${Math.round(s.goal.pct * 100)} %` : "—"} note={s.goal ? `${km1(s.km)} de ${km1(s.goal.target)} km` : "Sin objetivo"} />
        </dl>
        {/* Km por día */}
        <div className="mt-5">
          <div className="text-[12px] text-fg-2">Km por día</div>
          <div className="mt-2 grid grid-cols-7 items-end gap-1.5" style={{ height: 96 }} role="img" aria-label={`Km por día: ${s.daily.map((k, i) => `${["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][i]} ${km1(k)}`).join(", ")}`}>
            {s.daily.map((k, i) => (
              <div key={i} className="flex h-full flex-col items-center justify-end gap-1">
                {k > 0 && <span className="text-[10px] text-fg-2">{km1(k)}</span>}
                <span className="w-full rounded-t-md" style={{ height: `${Math.max(k > 0 ? 6 : 2, (k / maxDay) * 64)}px`, background: k > 0 ? "var(--lime)" : "var(--ov-2)" }} />
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1.5 text-center text-[11px] text-fg-2" aria-hidden="true">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
        {s.byType.length > 1 && (
          <p className="mt-4 text-[12px] text-fg-2">Por tipo: {s.byType.map((t) => `${t.label} ${km1(t.km)} km`).join(" · ")}</p>
        )}
      </section>

      {/* Previsto frente a realizado */}
      <section className="card p-5" aria-label="Previsto frente a realizado">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow">Previsto frente a realizado</div>
          <Link href="/plan" className="-my-3 -mr-2 inline-flex min-h-[44px] flex-none items-center px-2 text-[12px] whitespace-nowrap text-fg-2">
            Plan ›
          </Link>
        </div>
        {plan.length ? (
          <ul className="mt-2 divide-y divide-line">
            {plan.map((p, i) => (
              <li key={i} className="flex min-h-[52px] items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-[14px]">
                  <b>{p.label}</b>
                  <span className="text-fg-2"> · {fmt(p.day, { weekday: "long", day: "numeric" })}</span>
                  <div className="text-[12px] text-fg-2">
                    {p.mine ? "Puesta por mí" : "Sugerida"}
                    {p.doneWhen ? ` · ${p.doneWhen}` : ""}
                    {p.manual ? " · vínculo a mano" : ""}
                  </div>
                </div>
                <span
                  className="flex-none rounded-full px-2.5 py-1 text-[12px] font-semibold"
                  style={{ color: STATE[p.status].color, background: `color-mix(in srgb, ${STATE[p.status].color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${STATE[p.status].color} 40%, transparent)` }}
                >
                  {STATE[p.status].label}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] text-fg-2">Sin plan guardado para esta semana.</p>
        )}
        {s.unplanned > 0 && plan.length > 0 && <p className="mt-2 text-[12px] text-fg-2">{s.unplanned === 1 ? "1 carrera no prevista." : `${s.unplanned} carreras no previstas.`}</p>}
        <p className="mt-2 text-[11px] text-fg-3">Una carrera de la semana cubre la sesión de su tipo aunque sea otro día; lo vinculado a mano manda.</p>
      </section>

      {/* Carreras */}
      <section className="card p-5" aria-label="Carreras de la semana">
        <div className="eyebrow">Carreras</div>
        {runs.length ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/actividad/${r.id}`} className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2 text-[14px]">
                  <span className="min-w-0 flex-1">
                    <b>{r.typeLabel}</b>
                    <span className="text-fg-2">
                      {" "}
                      · {r.dayLabel}
                      {r.distanceM ? ` · ${km1(r.distanceM / 1000)} km` : ""}
                      {r.pace ? ` · ${r.pace} /km` : ""}
                    </span>
                  </span>
                  {r.rating !== null && <span className="text-[12px] text-fg-2">{r.rating}/5</span>}
                  <span className="text-fg-3" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] text-fg-2">Ninguna esta semana.</p>
        )}
      </section>
    </div>
  );
}

function Lines({ lines }: { lines: WeekLine[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {lines.map((l) => (
        <li key={l.text} className="flex gap-2.5 text-[14px] leading-snug">
          <span className="mt-[7px] h-2 w-2 flex-none rounded-full" style={{ background: TONE[l.tone] }} aria-hidden="true" />
          <span>
            {l.tone === "good" && <span className="sr-only">Bien: </span>}
            {l.tone === "watch" && <span className="sr-only">A tener en cuenta: </span>}
            {l.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-fg-2">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className={`num text-[22px] ${value === "—" ? "text-fg-3" : ""}`}>{value}</span>
        {unit && <span className="text-[11px] text-fg-2">{unit}</span>}
      </dd>
      {note && <dd className="text-[11px] text-fg-2">{note}</dd>}
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d={dir === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
