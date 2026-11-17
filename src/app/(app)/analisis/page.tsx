import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { BarsChart, StackedTypeYears, TrendChart } from "@/components/charts/charts";
import { SessionIcon } from "@/components/ui/SessionType";
import { TypeBreakdown } from "@/components/ui/TypeBreakdown";
import { SESSION_TYPES, TYPE_META } from "@/lib/analysis/session-type";
import { Card, PageHeader } from "@/components/ui/primitives";
import { DEFAULT_HR_BAND, MIN_DISTANCE_M, parseBand } from "@/lib/analysis/pace-at-hr";
import { getAnalysis } from "@/lib/db/queries";
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
                <div className="relative h-[32px] rounded-xl bg-white/[0.04]">
                  {y.paceSPerKm !== null ? (
                    <div
                      className={`h-full rounded-xl ${best ? "bg-lime shadow-[0_0_16px_rgba(200,242,58,0.45)]" : "bg-[#3A3D35]"}`}
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
