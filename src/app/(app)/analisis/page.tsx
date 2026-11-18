import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { BarsChart, StackedTypeYears, TrendChart } from "@/components/charts/charts";
import { SessionIcon } from "@/components/ui/SessionType";
import { TypeBreakdown } from "@/components/ui/TypeBreakdown";
import { SESSION_TYPES, TYPE_META } from "@/lib/analysis/session-type";
import { Card, PageHeader } from "@/components/ui/primitives";
import { DEFAULT_HR_BAND, MIN_DISTANCE_M, parseBand } from "@/lib/analysis/pace-at-hr";
import { getAnalysis, getEfficiency, getInsights, getPeriodsView } from "@/lib/db/queries";
import { ConsistencyCalendar, PaceTrend, YearCumulative } from "@/components/charts/InsightCharts";
import type { PaceRange } from "@/lib/analysis/insights";
import { isSessionType, type SessionType } from "@/lib/analysis/session-type";
import { PeriodCharts } from "@/components/charts/PeriodCharts";
import { rangeLabel, type PeriodUnit } from "@/lib/analysis/periods";
import { DASH, date, dec, int, km, pace } from "@/lib/format";

export const metadata = { title: "Análisis · Stride Lab" };

const BANDS: [number, number][] = [
  [130, 140],
  [135, 145],
  [140, 150],
  [145, 155],
  [150, 160],
];

export default function AnalysisPage({ searchParams }: PageProps<"/analisis">) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Análisis" subtitle="Tu evolución, no solo tus kilómetros." />
      </div>
      <Link href="/analisis/records" className="card flex min-h-[64px] items-center gap-3 px-4 py-3 active:opacity-80">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-lime text-lime-ink" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M8 4h8v5a4 4 0 0 1-8 0V4Zm4 9v4m-4 3h8M8 6H5v1a3 3 0 0 0 3 3m8-4h3v1a3 3 0 0 1-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="flex-1">
          <span className="block font-display text-[16px] font-bold">Récords</span>
          <span className="block text-[12px] text-fg-2">1 km, milla, 5 km, 10 km, media y maratón</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="text-fg-3">
          <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </Link>
      <Suspense fallback={<div className="card h-[520px] animate-pulse" aria-hidden="true" />}>
        <AnalysisData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AnalysisData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const band = parseBand(typeof sp.fc === "string" ? sp.fc : undefined);
  const allTime = sp.periodo === "todo";
  const unit: PeriodUnit = sp.vista === "mes" ? "month" : sp.vista === "año" || sp.vista === "ano" ? "year" : "week";
  const weeks: 12 | 26 = sp.semanas === "26" ? 26 : 12;
  const keepFc = typeof sp.fc === "string" ? `fc=${sp.fc}&` : "";
  const a = await getAnalysis(band);

  const latest = a.vo2.at(-1) ?? null;
  const peak = a.vo2.reduce<(typeof a.vo2)[number] | null>((m, p) => (!m || p.value > m.value ? p : m), null);
  const withPace = a.paceAtHr.filter((y) => y.paceSPerKm !== null);
  const fastest = withPace.length ? Math.min(...withPace.map((y) => y.paceSPerKm!)) : null;
  const slowest = withPace.length ? Math.max(...withPace.map((y) => y.paceSPerKm!)) : null;
  const thisYear = a.kmByYear.at(-1)?.year;
  const emptyYears = a.kmByYear.filter((y) => y.runs === 0).map((y) => y.year);

  return (
    <div className="stagger flex flex-col gap-4">
      {/* VO₂ máx. */}
      <section className="card card-hero p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">VO₂ máx. · todo el historial</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="num text-[44px]">{latest ? dec(latest.value) : DASH}</span>
              {latest && <span className="text-[12px] text-fg-2">{date(latest.day + "T12:00:00Z")}</span>}
            </div>
          </div>
          {peak && (
            <div className="text-right text-[12px] leading-[1.5] text-fg-2">
              Pico
              <br />
              <b className="num text-[18px] text-fg">{dec(peak.value)}</b>
              <br />
              {date(peak.day + "T12:00:00Z", { month: "short", year: "numeric" })}
            </div>
          )}
        </div>
        <div className="relative mt-3">
          {a.vo2.length > 1 ? (
            <TrendChart points={a.vo2} height={210} zoom label="Evolución del VO₂ máx." />
          ) : (
            <p className="text-[14px] text-fg-2">Sin lecturas suficientes.</p>
          )}
        </div>
        <p className="relative mt-2 text-[12px] text-fg-2">
          {a.vo2.length} días con lectura · pellizca o arrastra para acercar. Estimación del Apple Watch.
        </p>
      </section>

      {/* Volumen por semana / mes / año */}
      <PeriodsCard unit={unit} weeks={weeks} keep={keepFc} />

      {/* Evolución del ritmo, calendario y comparación de años */}
      <InsightsCards sp={sp} />

      {/* Ritmo a igual pulso */}
      <Card>
        <div className="eyebrow">Ritmo con el mismo pulso</div>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-2">
          Carreras de {MIN_DISTANCE_M / 1000} km o más, sin sesiones especiales, con FC media entre {band[0]} y {band[1]} ppm.
          Cuanto más larga la barra, más rápido a ese pulso.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Franja de pulso">
          {BANDS.map(([lo, hi]) => {
            const active = lo === band[0] && hi === band[1];
            const href = lo === DEFAULT_HR_BAND[0] && hi === DEFAULT_HR_BAND[1] ? "/analisis" : `/analisis?fc=${lo}-${hi}`;
            return (
              <Link
                key={lo}
                href={href}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-[36px] items-center rounded-full px-3 text-[13px] font-semibold ${
                  active ? "bg-lime text-lime-ink" : "border border-line-strong text-fg-2"
                }`}
              >
                {lo}–{hi}
              </Link>
            );
          })}
        </div>
        <ul className="mt-5 flex flex-col gap-2.5">
          {a.paceAtHr.map((y) => {
            const w =
              y.paceSPerKm === null || fastest === null || slowest === null
                ? 0
                : slowest === fastest
                  ? 100
                  : 40 + (60 * (slowest - y.paceSPerKm)) / (slowest - fastest);
            const best = y.paceSPerKm !== null && y.paceSPerKm === fastest;
            return (
              <li key={y.year} className="grid grid-cols-[40px_1fr_auto] items-center gap-3">
                <span className="num text-[14px] text-fg-2">{y.year}</span>
                <div className="relative h-[32px] rounded-xl bg-ov-1">
                  {y.paceSPerKm !== null ? (
                    <div
                      className={`h-full rounded-xl ${best ? "bg-lime shadow-[0_0_16px_rgba(200,242,58,0.45)]" : "bg-bar"}`}
                      style={{ width: `${w}%` }}
                    />
                  ) : (
                    <span className="absolute inset-y-0 left-3 flex items-center text-[12px] text-fg-3">Sin carreras en la franja</span>
                  )}
                </div>
                <div className="w-[92px] text-right">
                  {y.paceSPerKm !== null ? (
                    <>
                      <div className="num text-[16px]">{pace(y.paceSPerKm)}</div>
                      <div className="text-[11px] text-fg-2">
                        {y.runs} {y.runs === 1 ? "carrera" : "carreras"} · {int(y.avgHr)} ppm
                      </div>
                    </>
                  ) : (
                    <div className="num text-[16px] text-fg-3">{DASH}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {a.firstHrYear !== null && a.firstHrYear > (a.paceAtHr[0]?.year ?? a.firstHrYear) && (
          <p className="mt-4 text-[12px] text-fg-2">
            Hay pulso registrado desde {a.firstHrYear}: los años anteriores salen vacíos.
          </p>
        )}
      </Card>

      {/* Km por año */}
      <Card>
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Kilómetros por año</div>
          {thisYear && <span className="text-[12px] text-fg-2">{thisYear} hasta hoy</span>}
        </div>
        <div className="mt-3">
          <BarsChart
            label="Kilómetros por año"
            height={170}
            highlight={a.kmByYear.length - 1}
            bars={a.kmByYear.map((y) => ({
              key: String(y.year),
              label: String(y.year).slice(2),
              value: y.km,
              tooltip: `${y.year} · ${y.runs} ${y.runs === 1 ? "carrera" : "carreras"}`,
            }))}
          />
        </div>
        {emptyYears.length > 0 && (
          <p className="mt-2 text-[12px] text-fg-2">
            {emptyYears.join(", ")} sin carreras registradas.
          </p>
        )}
      </Card>

      {/* Km por tipo */}
      <section id="tipos" className="card scroll-mt-6 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="eyebrow">Km por tipo</div>
          <div className="flex gap-1.5" role="group" aria-label="Periodo">
            {[
              { k: "12m", label: "12 meses", href: `/analisis?${keepFc}#tipos`.replace("?#", "#") },
              { k: "todo", label: "Todo", href: `/analisis?${keepFc}periodo=todo#tipos` },
            ].map((o) => {
              const active = (o.k === "todo") === allTime;
              return (
                <Link
                  key={o.k}
                  href={o.href}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex min-h-[32px] items-center rounded-full px-2.5 text-[12px] font-semibold ${
                    active ? "bg-lime text-lime-ink" : "border border-line-strong text-fg-2"
                  }`}
                >
                  {o.label}
                </Link>
              );
            })}
          </div>
        </div>
        <TypeBreakdown data={allTime ? a.byTypeAll : a.byType12} />
        <div className="mt-6 eyebrow">Por año</div>
        <div className="mt-2">
          <StackedTypeYears
            label="Kilómetros por año y tipo de sesión"
            years={a.typeByYear}
            types={SESSION_TYPES.map((t) => ({ key: t, label: TYPE_META[t].label, color: TYPE_META[t].color }))}
          />
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Leyenda">
          {SESSION_TYPES.map((t) => (
            <li key={t} className="flex items-center gap-1 text-[11px] text-fg-2">
              <span style={{ color: TYPE_META[t].color }} className="flex">
                <SessionIcon type={t} size={13} />
              </span>
              {TYPE_META[t].label}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="eyebrow">Carreras</div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="num text-[34px]">{int(a.totalRuns)}</span>
            <span className="text-[12px] text-fg-2">válidas</span>
          </div>
        </Card>
        <Card>
          <div className="eyebrow">Más larga</div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="num text-[34px]">{a.longestM === null ? DASH : km(a.longestM, 1)}</span>
            {a.longestM !== null && <span className="text-[12px] text-fg-2">km</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}

const UNIT_LABEL: Record<PeriodUnit, string> = { week: "Semana", month: "Mes", year: "Año" };
const UNIT_PARAM: Record<PeriodUnit, string> = { week: "semana", month: "mes", year: "año" };
const STRETCH_TEXT: Record<PeriodUnit, { now: string; prev: string; whole: string; short: string }> = {
  week: { now: "semana", prev: "de la semana pasada", whole: "la semana pasada entera", short: "la semana pasada" },
  month: { now: "mes", prev: "del mes pasado", whole: "el mes pasado entero", short: "el mes pasado" },
  year: { now: "año", prev: "del año pasado", whole: "el año pasado entero", short: "el año pasado" },
};
// [actual, anterior con artículo, «frente a …»]
const PREV_LABEL: Record<PeriodUnit, [string, string, string]> = {
  week: ["Esta semana", "la semana pasada", "la semana pasada"],
  month: ["Este mes", "el mes pasado", "el mes pasado"],
  year: ["Este año", "el año pasado", "el año pasado"],
};

async function PeriodsCard({ unit, weeks, keep }: { unit: PeriodUnit; weeks: 12 | 26; keep: string }) {
  const { periods, comparison, goalKm, injuries, injuryRanges } = await getPeriodsView(unit, weeks);
  const href = (u: PeriodUnit, w: number = weeks) =>
    `/analisis?${keep}vista=${encodeURIComponent(UNIT_PARAM[u])}${u === "week" && w === 26 ? "&semanas=26" : ""}#volumen`;
  const chip = (active: boolean) =>
    `inline-flex min-h-[36px] flex-1 items-center justify-center rounded-full text-[13px] font-semibold ${
      active ? "bg-lime text-lime-ink" : "text-fg-2"
    }`;
  const c = comparison;
  return (
    <section id="volumen" className="card scroll-mt-6 p-5">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Volumen</div>
        {unit === "week" && (
          <div className="flex gap-1.5 text-[12px]" role="group" aria-label="Semanas">
            {[12, 26].map((w) => (
              <Link
                key={w}
                href={href("week", w)}
                scroll={false}
                aria-current={weeks === w ? "true" : undefined}
                className={`rounded-full px-2.5 py-1 font-semibold ${weeks === w ? "bg-ov-2 text-fg" : "text-fg-2"}`}
              >
                {w} sem.
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex rounded-full border border-line-strong p-1" role="group" aria-label="Periodo">
        {(["week", "month", "year"] as const).map((u) => (
          <Link key={u} href={href(u)} scroll={false} aria-current={unit === u ? "true" : undefined} className={chip(unit === u)}>
            {UNIT_LABEL[u]}
          </Link>
        ))}
      </div>

      {c && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-inset p-3.5">
              <div className="text-[12px] text-fg-2">
                {PREV_LABEL[unit][0]} · {rangeLabel(c.currentFrom, c.currentTo)}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="num text-[24px]">{km(c.current.km * 1000, 1)}</span>
                <span className="text-[11px] text-fg-2">km</span>
              </div>
              <div className="mt-0.5 text-[12px] text-fg-2">
                {c.kmDelta === 0 ? "Igual que" : `${c.kmDelta > 0 ? "+" : "−"}${km(Math.abs(c.kmDelta) * 1000, 1)} km frente a`}{" "}
                {rangeLabel(c.previousFrom, c.previousTo, unit === "year")} ({km(c.previous.km * 1000, 1)})
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-inset p-3.5">
              <div className="text-[12px] text-fg-2">Ritmo medio · mismo tramo</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="num text-[24px]">{pace(c.current.paceSPerKm)}</span>
                <span className="text-[11px] text-fg-2">/km</span>
              </div>
              <div className="mt-0.5 text-[12px] text-fg-2">
                {c.paceDeltaS === null
                  ? `Sin datos para comparar con ${rangeLabel(c.previousFrom, c.previousTo, unit === "year")}`
                  : Math.round(c.paceDeltaS) === 0
                    ? `Igual que ${rangeLabel(c.previousFrom, c.previousTo, unit === "year")}`
                    : `${Math.abs(Math.round(c.paceDeltaS))} s/km ${c.paceDeltaS < 0 ? "más rápido" : "más lento"} que ${rangeLabel(c.previousFrom, c.previousTo, unit === "year")} (${pace(c.previous.paceSPerKm)})`}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-fg-2">
            Compara lo que llevas de {STRETCH_TEXT[unit].now} con el mismo tramo {STRETCH_TEXT[unit].prev} (
            {rangeLabel(c.previousFrom, c.previousTo, unit === "year")}), no con {STRETCH_TEXT[unit].whole}.
            {c.capped && ` Como ${STRETCH_TEXT[unit].short} fue más corto, se compara completo.`}
          </p>
        </>
      )}

      <div className="mt-4">
        <PeriodCharts key={`${unit}-${weeks}`} periods={periods} unit={unit} goalKm={goalKm} injuryRanges={injuryRanges} />
      </div>
      <p className="mt-3 text-[12px] text-fg-2">
        Toca una columna para ver su detalle. El periodo actual va en lima{goalKm ? "; la línea discontinua es tu objetivo" : ""}. Las
        sesiones especiales (más de 8:00 /km) suman km pero no cuentan en el ritmo medio.
        {injuries.length > 0 &&
          " Las carreras en periodos de lesión (banda gris) suman km, pero no cuentan en el ritmo medio ni en la comparación con el periodo anterior."}
      </p>
    </section>
  );
}

const RANGES: [PaceRange, string][] = [
  ["1m", "1 mes"],
  ["3m", "3 meses"],
  ["6m", "6 meses"],
  ["1y", "1 año"],
  ["all", "Todo"],
];
const PACE_TYPES: (SessionType | null)[] = [null, "rodaje", "series", "tempo", "tirada_larga", "recuperacion", "trail", "cinta", "competicion"];

async function InsightsCards({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const range = (RANGES.map((r) => r[0]) as string[]).includes(String(sp.rango)) ? (sp.rango as PaceRange) : "6m";
  const paceType = isSessionType(sp.rtipo) ? sp.rtipo : null;
  const calMetric = sp.cal === "carga" ? "load" : "km";
  const { points, trend, calendar, ytd, ytdNoInjury, bands, yearBands, nowMs } = await getInsights(range, paceType);
  const hasInjuries = bands.length > 0;

  // Enlaces que conservan el resto de parámetros.
  const link = (patch: Record<string, string | null>, anchor: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const qs = q.toString();
    return `/analisis${qs ? `?${qs}` : ""}#${anchor}`;
  };
  const chip = (active: boolean) =>
    `inline-flex min-h-[34px] flex-none items-center gap-1 rounded-full px-3 text-[12px] font-semibold ${
      active ? "bg-lime text-lime-ink" : "border border-line-strong text-fg-2"
    }`;
  // La tabla compara sin las carreras en periodos de lesión.
  const c = ytdNoInjury.current;
  const p = ytdNoInjury.previous;
  const delta = (a: number | null, b: number | null, fmt: (n: number) => string, lowerIsBetter = false) => {
    if (a === null || b === null) return <span className="text-fg-3">—</span>;
    const d = a - b;
    if (Math.abs(d) < 1e-9) return <span className="text-fg-2">=</span>;
    const good = lowerIsBetter ? d < 0 : d > 0;
    return <span className={good ? "text-lime-text" : "text-fg-2"}>{(d > 0 ? "+" : "−") + fmt(Math.abs(d))}</span>;
  };
  const rows: [string, string, string, React.ReactNode][] = [
    ["Km", km(c.km * 1000, 1), km(p.km * 1000, 1), delta(c.km, p.km, (n) => km(n * 1000, 1))],
    ["Horas", dec(c.hours), dec(p.hours), delta(c.hours, p.hours, (n) => dec(n))],
    [
      "Desnivel +",
      c.elevationGainM === null ? "—" : `${int(c.elevationGainM)} m`,
      p.elevationGainM === null ? "—" : `${int(p.elevationGainM)} m`,
      delta(c.elevationGainM, p.elevationGainM, (n) => `${int(n)} m`),
    ],
    ["Carreras", String(c.runs), String(p.runs), delta(c.runs, p.runs, (n) => String(n))],
    [
      "Ritmo medio",
      c.paceSPerKm === null ? "—" : pace(c.paceSPerKm),
      p.paceSPerKm === null ? "—" : pace(p.paceSPerKm),
      delta(c.paceSPerKm, p.paceSPerKm, (n) => `${Math.round(n)} s/km`, true),
    ],
  ];

  return (
    <>
      <section id="ritmo" className="card scroll-mt-6 p-5">
        <div className="eyebrow">Evolución del ritmo</div>
        <div className="-mx-5 mt-3 overflow-x-auto px-5 [scrollbar-width:none]">
          <div className="flex w-max gap-1.5" role="group" aria-label="Rango">
            {RANGES.map(([r, label]) => (
              <Link key={r} href={link({ rango: r === "6m" ? null : r }, "ritmo")} scroll={false} aria-current={r === range ? "true" : undefined} className={chip(r === range)}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="-mx-5 mt-2 overflow-x-auto px-5 [scrollbar-width:none]">
          <div className="flex w-max gap-1.5" role="group" aria-label="Tipo de sesión">
            {PACE_TYPES.map((t) => (
              <Link
                key={t ?? "todos"}
                href={link({ rtipo: t }, "ritmo")}
                scroll={false}
                aria-current={t === paceType ? "true" : undefined}
                className={chip(t === paceType)}
              >
                {t && (
                  <span className="flex" style={{ color: t === paceType ? undefined : TYPE_META[t].color }}>
                    <SessionIcon type={t} size={13} />
                  </span>
                )}
                {t ? TYPE_META[t].label : "Todos"}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <PaceTrend key={`${range}-${paceType}`} points={points} trend={trend} bands={bands} nowMs={nowMs} />
        </div>
        <p className="mt-2 text-[12px] text-fg-2">
          {points.length} {points.length === 1 ? "carrera" : "carreras"}. Sin sesiones especiales (más de 8:00 /km).
        </p>
      </section>

      <EfficiencyCard sp={sp} />

      <section id="calendario" className="card scroll-mt-6 p-5">
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Constancia · 12 meses</div>
          <div className="flex gap-1.5" role="group" aria-label="Intensidad según">
            {(
              [
                ["km", "Km"],
                ["load", "Carga"],
              ] as const
            ).map(([m, label]) => (
              <Link
                key={m}
                href={link({ cal: m === "load" ? "carga" : null }, "calendario")}
                scroll={false}
                aria-current={m === calMetric ? "true" : undefined}
                className={chip(m === calMetric)}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <ConsistencyCalendar key={calMetric} days={calendar} metric={calMetric} bands={bands} />
        </div>
        {calMetric === "load" && (
          <p className="mt-2 text-[12px] text-fg-2">Los días con carrera pero sin pulso no tienen carga y salen en gris.</p>
        )}
      </section>

      <section id="anios" className="card scroll-mt-6 p-5">
        <div className="eyebrow">
          {ytd.year} frente a {ytd.year - 1}
        </div>
        <div className="mt-3">
          <YearCumulative year={ytd.year} current={ytd.currentCum} previous={ytd.previousCum} bands={yearBands} />
        </div>
        <table className="mt-4 w-full text-[14px]">
          <caption className="mb-2 text-left text-[12px] text-fg-2">
            Del 1 de enero hasta hoy, frente al mismo tramo de {ytd.year - 1}. Ritmo sin sesiones especiales
            {hasInjuries ? "; toda la tabla, sin periodos de lesión (el gráfico sí los incluye)." : "."}
          </caption>
          <thead>
            <tr className="text-[11px] tracking-[0.06em] text-fg-2 uppercase">
              <th scope="col" className="pb-1 text-left font-semibold"></th>
              <th scope="col" className="pb-1 text-right font-semibold">{ytd.year}</th>
              <th scope="col" className="pb-1 text-right font-semibold">{ytd.year - 1}</th>
              <th scope="col" className="pb-1 text-right font-semibold">Dif.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, a, b, d]) => (
              <tr key={label}>
                <th scope="row" className="py-2 text-left font-normal text-fg-2">
                  {label}
                </th>
                <td className="num py-2 text-right text-[15px]">{a}</td>
                <td className="num py-2 text-right text-[15px] text-fg-2">{b}</td>
                <td className="py-2 text-right text-[13px] font-semibold">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Eficiencia aeróbica: ritmo en Z2 de cada carrera (últimos 6 meses) y su tendencia. */
async function EfficiencyCard({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const all = sp.ef === "todos";
  const { points, trend, band, changeS, bands, nowMs } = await getEfficiency(all ? null : "rodaje");
  const link = (v: string | null) => {
    const q = new URLSearchParams();
    for (const [k, x] of Object.entries(sp)) if (typeof x === "string") q.set(k, x);
    if (v === null) q.delete("ef");
    else q.set("ef", v);
    const qs = q.toString();
    return `/analisis${qs ? `?${qs}` : ""}#eficiencia`;
  };
  const chip = (active: boolean) =>
    `inline-flex min-h-[34px] items-center rounded-full px-3 text-[12px] font-semibold ${active ? "bg-lime text-lime-ink" : "border border-line-strong text-fg-2"}`;
  const ch = changeS === null ? null : Math.round(changeS);
  return (
    <section id="eficiencia" className="card scroll-mt-6 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">Eficiencia aeróbica · 6 meses</div>
        <span className="text-[11px] text-fg-2">
          Z2 {band[0]}–{band[1]} ppm
        </span>
      </div>
      <div className="mt-3 flex gap-1.5" role="group" aria-label="Tipo de sesión">
        <Link href={link(null)} scroll={false} aria-current={!all ? "true" : undefined} className={chip(!all)}>
          Rodaje
        </Link>
        <Link href={link("todos")} scroll={false} aria-current={all ? "true" : undefined} className={chip(all)}>
          Todas
        </Link>
      </div>
      {ch !== null && (
        <p className="mt-3 text-[14px]">
          {ch === 0 ? (
            "Tendencia estable: mismo ritmo al mismo pulso."
          ) : (
            <>
              Tendencia: <b className={ch < 0 ? "text-lime-text" : ""}>{Math.abs(ch)} s/km {ch < 0 ? "más rápido" : "más lento"}</b> al mismo pulso
              que hace 6 meses.
            </>
          )}
        </p>
      )}
      <div className="mt-3">
        <PaceTrend key={all ? "todos" : "rodaje"} points={points} trend={trend} bands={bands} nowMs={nowMs} />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-2">
        Cada punto es el ritmo medio de una carrera mientras tu pulso estuvo en Z2 (al menos 5 minutos en Z2; sin pausas ni muestras inválidas). Más
        arriba = más rápido al mismo pulso = más eficiente. {points.length} {points.length === 1 ? "carrera" : "carreras"}
        {all ? "" : " de Rodaje"}.
      </p>
    </section>
  );
}
