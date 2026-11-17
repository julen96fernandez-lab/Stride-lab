import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { BarsChart, TrendChart } from "@/components/charts/charts";
import { GreetingTitle, TodayLabel } from "@/components/ui/Greeting";
import { Logo } from "@/components/ui/Logo";
import { RouteThumb } from "@/components/map/RouteMap";
import { ButtonLink, Card, SectionTitle, Stat } from "@/components/ui/primitives";
import { CountUp } from "@/components/ui/CountUp";
import { TypeBreakdown } from "@/components/ui/TypeBreakdown";
import { getHome } from "@/lib/db/queries";
import { DASH, cap, date, dec, duration, int, km, pace } from "@/lib/format";

const MONTH_LETTER = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAME = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mt-2 flex items-center justify-between">
        <Logo />
        <TodayLabel />
      </div>
      <Suspense fallback={<HomeSkeleton />}>
        <HomeData />
      </Suspense>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="mt-3 h-[84px]" />
      <div className="card h-[300px] animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        <div className="card h-[110px] animate-pulse" />
        <div className="card h-[110px] animate-pulse" />
      </div>
    </div>
  );
}

function daysAgo(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Tu última carrera fue hoy.";
  if (days === 1) return "Tu última carrera fue ayer.";
  return `Tu última carrera fue hace ${days} días.`;
}

async function HomeData() {
  await connection();
  const h = await getHome();

  if (h.totalRuns === 0) {
    return (
      <div className="stagger flex flex-col gap-4">
        <div className="mt-3">
          <GreetingTitle />
          <p className="mt-2 text-[15px] text-fg-2">Aún no hay carreras importadas.</p>
        </div>
        <Card hero>
          <p className="relative text-[15px] text-fg-2">Importa tu export de Apple Health para empezar.</p>
          <div className="relative mt-5">
            <ButtonLink href="/perfil/importar">Importar datos</ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const vo2 = h.vo2;
  const latest = vo2.at(-1) ?? null;
  const peak = vo2.reduce<(typeof vo2)[number] | null>((m, p) => (!m || p.value > m.value ? p : m), null);
  const peakDelta = latest && peak ? latest.value - peak.value : null;
  const monthIdx = (ym: string) => Number(ym.slice(5, 7)) - 1;
  const best = h.months.reduce((m, x) => (x.km > m.km ? x : m), h.months[0]);
  const yearKm = h.months.reduce((a, m) => a + m.km, 0);
  const lr = h.lastRun;

  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-3">
        <GreetingTitle />
        {lr && <p className="mt-2 text-[15px] text-fg-2">{daysAgo(lr.startAt)}</p>}
      </div>

      {/* VO₂ máx. */}
      <Link href="/analisis" className="block">
        <section className="card card-hero p-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">VO₂ máx.</div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="num text-[60px] text-fg">{latest ? <CountUp value={latest.value} decimals={1} /> : DASH}</span>
                {latest && <span className="text-[13px] text-fg-2">mL/kg·min</span>}
              </div>
            </div>
            {peakDelta !== null && peak && peakDelta < -0.05 && (
              <span className="mt-1 rounded-full border border-line-strong px-2.5 py-1 text-[12px] font-semibold text-fg-2">
                {dec(peakDelta)} desde {MONTH_NAME[Number(peak.day.slice(5, 7)) - 1]}
              </span>
            )}
          </div>
          <div className="relative mt-3">
            <TrendChart points={vo2} height={110} label="VO₂ máx. en los últimos 14 meses" />
          </div>
          <div className="relative mt-2 flex justify-between text-[11px] text-fg-2">
            <span>{vo2[0] ? date(vo2[0].day + "T12:00:00Z", { month: "short", year: "numeric" }) : ""}</span>
            {peak && <span>Pico {dec(peak.value)} · {date(peak.day + "T12:00:00Z", { month: "short", year: "numeric" })}</span>}
            <span>Hoy</span>
          </div>
          <p className="relative mt-3 text-[12px] text-fg-2">Estimación del Apple Watch, no una medición de laboratorio.</p>
        </section>
      </Link>

      {/* Últimos 28 días */}
      <SectionTitle aside={`${h.last28.runs} ${h.last28.runs === 1 ? "carrera" : "carreras"}`}>Últimos 28 días</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <Stat label="Distancia" value={h.last28.distanceM ? km(h.last28.distanceM, 1) : null} unit="km" />
        </Card>
        <Card>
          <Stat label="Ritmo medio" value={h.last28.paceSPerKm ? pace(h.last28.paceSPerKm) : null} unit="/km" hint="Sin sesiones especiales" />
        </Card>
        <Card>
          <Stat label="Tiempo" value={h.last28.durationS ? duration(h.last28.durationS) : null} />
        </Card>
        <Card>
          <Stat label="Pulso medio" value={h.last28.avgHr ? int(h.last28.avgHr) : null} unit="ppm" />
        </Card>
      </div>

      {/* Volumen 12 meses */}
      <Card>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="eyebrow">Volumen · 12 meses</div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="num text-[34px]">{int(yearKm)}</span>
              <span className="text-[13px] text-fg-2">km</span>
            </div>
          </div>
          {best && best.km > 0 && (
            <span className="text-[12px] text-fg-2">
              Mejor mes: {MONTH_NAME[monthIdx(best.month)]} · {int(best.km)} km
            </span>
          )}
        </div>
        <div className="mt-3">
          <BarsChart
            label="Kilómetros por mes en los últimos 12 meses"
            highlight={h.months.length - 1}
            bars={h.months.map((m) => ({
              key: m.month,
              label: MONTH_LETTER[monthIdx(m.month)],
              value: m.km,
              tooltip: `${MONTH_NAME[monthIdx(m.month)]} ${m.month.slice(0, 4)} · ${m.runs} ${m.runs === 1 ? "carrera" : "carreras"}`,
            }))}
          />
        </div>
      </Card>

      {/* Km por tipo */}
      <Card>
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Km por tipo · 12 meses</div>
          <Link href="/analisis#tipos" className="text-[12px] text-fg-2">
            Ver historial
          </Link>
        </div>
        <TypeBreakdown data={h.byType} />
      </Card>

      {/* Última carrera */}
      {lr && (
        <Link href={`/actividad/${lr.id}`} className="block">
          <Card>
            <div className="flex items-center justify-between">
              <div className="eyebrow">Última carrera</div>
              <span className="text-[13px] text-fg-2">{cap(date(lr.startAt, { weekday: "short", day: "numeric", month: "short" }))}</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <RouteThumb shape={lr.route} size={100} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1">
                  <span className="num text-[36px]">{km(lr.distanceM)}</span>
                  <span className="text-[13px] text-fg-2">km</span>
                </div>
                <div className="mt-2 flex flex-col gap-0.5 text-[14px]">
                  <span>
                    <b className="font-semibold">{duration(lr.durationS)}</b> <span className="text-fg-2">tiempo</span>
                  </span>
                  <span>
                    <b className="font-semibold">{pace(lr.avgPaceSPerKm)}</b> <span className="text-fg-2">/km</span>
                  </span>
                  <span>
                    <b className="font-semibold">{lr.avgHr === null ? DASH : int(lr.avgHr)}</b> <span className="text-fg-2">ppm</span>
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </Link>
      )}
    </div>
  );
}
