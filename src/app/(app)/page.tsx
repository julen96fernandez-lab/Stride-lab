import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Sparkline, TrendChart } from "@/components/charts/charts";
import { GreetingTitle, TodayLabel } from "@/components/ui/Greeting";
import { Logo } from "@/components/ui/Logo";
import { RouteThumb } from "@/components/map/RouteMap";
import { ButtonLink, Card, SectionTitle, Stat } from "@/components/ui/primitives";
import { TypeBreakdown } from "@/components/ui/TypeBreakdown";
import { Ring } from "@/components/ui/GoalCard";
import { homeScreen } from "@/lib/db/screens";
import { HomeSkeleton } from "@/components/ui/Skeletons";
import { cacheDay } from "@/lib/cache/tags";
import { FitnessMini } from "@/components/charts/FitnessCharts";
import { RaceCountdown } from "@/components/race/RaceCards";
import { rangeLabel } from "@/lib/analysis/periods";
import type { TodayKind } from "@/lib/analysis/home";
import { mineKindForToday } from "@/lib/plan/mine";
import { DASH, cap, date, dec, duration, int, km, pace } from "@/lib/format";

const MONTH_NAME = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const km1 = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const clock = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(t % 60).padStart(2, "0")}`;
};

export default function HomePage() {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="mt-2 flex items-center justify-between">
        <Logo />
        <TodayLabel />
      </div>
      <Suspense fallback={<HomeSkeleton />}>
        <HomeData />
      </Suspense>
      {/* Añadir carrera: botón fijo encima de la barra de pestañas. */}
      <Link
        href="/actividad/nueva"
        aria-label="Añadir carrera"
        className="fixed right-4 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-lime text-lime-ink shadow-[0_10px_30px_-8px_rgba(200,242,58,0.55)]"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 104px)" }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </Link>
    </div>
  );
}

const TODAY_STYLE: Record<TodayKind, { color: string; icon: string }> = {
  descanso: { color: "var(--fg-3)", icon: "M4 15h16M6 15V9a2 2 0 0 1 2-2h3v8m-5 0v3m14-3v3M11 11h7a2 2 0 0 1 2 2v2" },
  suave: { color: "var(--z2)", icon: "M3 17c3-6 6-6 9 0s6 6 9 0" },
  calidad: { color: "var(--z4)", icon: "M5 20V10m5 10V4m5 16v-7m5 7V8" },
  libre: { color: "var(--chart-line)", icon: "M12 3v18M3 12h18" },
};

async function HomeData() {
  await connection();
  const today = cacheDay();
  const { home: h, overview: o, nextRace, mineToday } = await homeScreen(today);

  if (h.totalRuns === 0) {
    return (
      <div className="stagger flex flex-col gap-4">
        <div className="mt-3">
          <GreetingTitle />
          <p className="mt-2 text-[15px] text-fg-2">Aún no hay carreras.</p>
        </div>
        <Card hero>
          <p className="relative text-[15px] text-fg-2">Importa tu export de Apple Health o añade una carrera a mano para empezar.</p>
          <div className="relative mt-5 flex flex-wrap gap-2">
            <ButtonLink href="/perfil/importar">Importar datos</ButtonLink>
            <ButtonLink href="/actividad/nueva" variant="ghost">
              Añadir carrera
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const lr = h.lastRun;
  const vo2 = h.vo2;
  const latestVo2 = vo2.at(-1) ?? null;
  const st = TODAY_STYLE[o.advice.kind];
  const w = o.week;
  const m = o.month;
  const cmp = m.cmp;

  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-3">
        <GreetingTitle />
      </div>

      {/* 7) Modo lesión */}
      {o.openInjury && (
        <Link
          href="/perfil#lesiones"
          className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-line-strong px-4 py-2.5"
          style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}
        >
          <span className="h-2.5 w-2.5 flex-none rounded-full bg-danger" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[14px]">
            <b className="font-semibold">Modo lesión</b> · desde {date(`${o.openInjury.startDate}T12:00:00Z`, { day: "numeric", month: "short" })}
            {o.openInjury.note ? <span className="text-fg-2"> · {o.openInjury.note}</span> : null}
          </span>
          <span className="text-[12px] text-fg-2">Perfil</span>
        </Link>
      )}

      {/* 1) Hoy */}
      <section className="card card-hero p-5" aria-label="Hoy">
        <div className="relative flex items-baseline justify-between">
          <div className="eyebrow">Hoy</div>
          <span className="text-[11px] text-fg-2">Estimación, no un plan</span>
        </div>
        <div className="relative mt-3 flex items-center gap-3">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${st.color} 18%, transparent)`, color: st.color }} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24">
              <path d={st.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="font-display text-[28px] leading-tight font-bold">{o.advice.label}</div>
          </div>
        </div>
        <p className="relative mt-2 text-[14px] leading-snug text-fg-2">{o.advice.reason}</p>
        {mineToday.length ? (
          <Link href={`/plan/sesion/${mineToday[0].id}`} className="relative mt-3 flex min-h-[48px] items-center gap-2 rounded-2xl border border-line bg-inset px-3.5 text-[14px]">
            <span className="min-w-0 flex-1">
              Tu sesión de hoy: <b>{mineToday[0].label}</b>
              {mineToday[0].detail ? <span className="text-fg-2"> · {mineToday[0].detail}</span> : null}
            </span>
            <span className="flex-none rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[11px] font-semibold text-lime-text">Puesta por mí</span>
          </Link>
        ) : (
          <Link
            href={`/plan/sesion/nueva?fecha=${today}&tipo=${mineKindForToday(o.advice.kind)}&volver=inicio`}
            className="relative mt-3 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-line-strong text-[15px] font-semibold"
          >
            Voy a correr hoy
          </Link>
        )}
      </section>

      {/* Carga y forma */}
      {/* Próxima carrera objetivo */}
      {nextRace && <RaceCountdown race={nextRace} />}

      {o.fitness && <FitnessMini f={o.fitness} />}

      {/* 2) Semana */}
      <section className="card p-5" aria-label="Esta semana">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Esta semana</div>
          <Link href="/analisis?vista=semana#volumen" className="-my-3 -mr-2 inline-flex min-h-[44px] items-center px-2 text-[12px] text-fg-2">
            Volumen
          </Link>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="relative">
            <Ring pct={w.goal?.pct ?? 0} size={78} />
            <span className="num absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span className="text-[18px]">{km1(w.km)}</span>
              <span className="mt-0.5 text-[9px] text-fg-2">km</span>
            </span>
          </div>
          <div className="min-w-0 flex-1">
            {w.goal ? (
              <>
                <div className="text-[14px]">
                  {w.goal.remainingKm > 0 ? (
                    <>
                      Faltan <b className="num">{km1(w.goal.remainingKm)} km</b> de {km1(w.goal.goalKm)}
                    </>
                  ) : (
                    <b className="text-lime-text">Objetivo de {km1(w.goal.goalKm)} km cumplido</b>
                  )}
                </div>
                {w.goal.remainingKm > 0 && (
                  <div className="mt-0.5 text-[12px] text-fg-2">
                    {km1(w.goal.kmPerDay)} km/día en {w.goal.daysLeft} {w.goal.daysLeft === 1 ? "día" : "días"}
                  </div>
                )}
              </>
            ) : (
              <Link href="/perfil#objetivos" className="text-[13px] text-fg-2 underline-offset-2 hover:underline">
                Sin objetivo semanal · ponerlo
              </Link>
            )}
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Días de la semana">
          {w.days.map((d) => {
            const ran = d.state === "corrido";
            return (
              <li key={d.date} className="flex flex-col items-center gap-1" aria-label={`${d.letter}: ${ran ? `${km1(d.km)} km` : d.state === "futuro" ? "por llegar" : d.isToday ? "hoy, sin correr" : "descanso"}`}>
                <span className={`text-[10px] font-semibold ${d.isToday ? "text-fg" : "text-fg-2"}`}>{d.letter}</span>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold ${
                    ran ? "bg-lime text-lime-ink" : d.state === "futuro" ? "border border-dashed border-line" : "bg-ov-2 text-fg-3"
                  } ${d.isToday ? "ring-2 ring-[var(--fg)] ring-offset-2 ring-offset-[var(--card)]" : ""}`}
                >
                  {ran ? <span className="num">{d.km >= 10 ? Math.round(d.km) : km1(d.km)}</span> : d.state === "descanso" ? "·" : ""}
                </span>
                <span className="h-3 text-[9px] text-fg-2">{d.isToday ? "hoy" : ""}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 3) Mes */}
      <section className="card p-5" aria-label="Este mes">
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Este mes · {rangeLabel(cmp.currentFrom, cmp.currentTo)}</div>
          <span className="text-[12px] text-fg-2">
            {m.runs} {m.runs === 1 ? "carrera" : "carreras"}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="relative">
            <Ring pct={m.goal?.pct ?? 0} size={78} />
            <span className="num absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span className="text-[18px]">{m.km >= 100 ? int(m.km) : km1(m.km)}</span>
              <span className="mt-0.5 text-[9px] text-fg-2">km</span>
            </span>
          </div>
          <div className="min-w-0 flex-1 text-[13px]">
            {m.goal && (
              <div className="text-[14px]">
                {m.goal.remainingKm > 0 ? (
                  <>
                    Faltan <b className="num">{km1(m.goal.remainingKm)} km</b> de {km1(m.goal.goalKm)}
                  </>
                ) : (
                  <b className="text-lime-text">Objetivo cumplido</b>
                )}
              </div>
            )}
            <div className="mt-0.5 text-fg-2">
              {/* La comparación no cuenta carreras en periodos de lesión: si hay, se dice. */}
              {Math.abs(cmp.current.km - m.km) > 0.05 && <>Sin lesión, {km1(cmp.current.km)} km: </>}
              {cmp.kmDelta === 0 ? "igual que" : <b className={cmp.kmDelta > 0 ? "text-lime-text" : "text-fg"}>{`${cmp.kmDelta > 0 ? "+" : "−"}${km1(Math.abs(cmp.kmDelta))} km`}</b>}{" "}
              frente al mismo tramo de {MONTH_NAME[Number(cmp.previousFrom.slice(5, 7)) - 1]} ({rangeLabel(cmp.previousFrom, cmp.previousTo)}: {km1(cmp.previous.km)} km)
            </div>
          </div>
        </div>
      </section>

      {/* 4) Última carrera */}
      {lr && (
        <Link href={`/actividad/${lr.id}`} className="block">
          <Card>
            <div className="flex items-center justify-between">
              <div className="eyebrow">Última carrera</div>
              <span className="text-[13px] text-fg-2">{cap(date(lr.startAt, { weekday: "short", day: "numeric", month: "short" }))}</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <RouteThumb shape={lr.route} size={88} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1">
                  <span className="num text-[32px]">{km(lr.distanceM)}</span>
                  <span className="text-[13px] text-fg-2">km</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[14px]">
                  <span>
                    <b className="font-semibold">{duration(lr.durationS)}</b>
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

      {/* 5) Más abajo */}
      <SectionTitle aside={`${h.last28.runs} ${h.last28.runs === 1 ? "carrera" : "carreras"}`}>Últimos 28 días</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <Stat label="Distancia" value={h.last28.distanceM ? km(h.last28.distanceM, 1) : null} unit="km" />
        </Card>
        <Card>
          <Stat label="Ritmo medio" value={h.last28.paceSPerKm ? pace(h.last28.paceSPerKm) : null} unit="/km" hint="Sin especiales ni lesión" />
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div className="eyebrow">Km por tipo · 12 meses</div>
          <Link href="/analisis#tipos" className="-my-3 -mr-2 inline-flex min-h-[44px] items-center px-2 text-[12px] text-fg-2">
            Ver historial
          </Link>
        </div>
        <TypeBreakdown data={h.byType} />
      </Card>

      <Link href="/analisis/records" className="block">
        <Card>
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">Récords · 12 meses</div>
            <span className="text-[12px] text-fg-2">Ver todos</span>
          </div>
          {o.recentRecords.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {o.recentRecords.map((r) => (
                <li key={r.key} className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px]">{r.label}</span>
                  <span className="text-[12px] text-fg-2">{date(r.startAt, { day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="num text-[18px]">{clock(r.timeS)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] text-fg-2">Ningún récord nuevo en los últimos 12 meses.</p>
          )}
        </Card>
      </Link>

      <Link href="/analisis#eficiencia" className="block">
        <Card>
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">Eficiencia aeróbica · Rodaje</div>
            <span className="text-[11px] text-fg-2">
              Z2 {o.efficiency.band[0]}–{o.efficiency.band[1]} ppm
            </span>
          </div>
          {o.efficiency.last ? (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="num text-[28px]">{pace(o.efficiency.last.pace)}</span>
                <span className="text-[12px] text-fg-2">/km en Z2 · última</span>
              </div>
              {o.efficiency.changeS !== null && Math.round(o.efficiency.changeS) !== 0 && (
                <p className="text-[12px] text-fg-2">
                  Tendencia 6 meses:{" "}
                  <b className={o.efficiency.changeS < 0 ? "text-lime-text" : "text-fg"}>
                    {Math.abs(Math.round(o.efficiency.changeS))} s/km {o.efficiency.changeS < 0 ? "más rápido" : "más lento"}
                  </b>{" "}
                  al mismo pulso
                </p>
              )}
              <div className="mt-2">
                <Sparkline points={o.efficiency.points.map((p) => ({ t: p.t, v: p.pace }))} inverse unit="pace" label="Ritmo en Z2 de los rodajes de los últimos 6 meses" />
              </div>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-fg-2">Sin rodajes con al menos 5 minutos en Z2 en los últimos 6 meses.</p>
          )}
        </Card>
      </Link>

      <Link href="/analisis" className="block">
        <Card>
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">VO₂ máx.</div>
            <span className="text-[11px] text-fg-2">Estimación del Apple Watch</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="num text-[28px]">{latestVo2 ? dec(latestVo2.value) : DASH}</span>
            {latestVo2 && <span className="text-[12px] text-fg-2">mL/kg·min</span>}
          </div>
          <div className="mt-2">
            <TrendChart points={vo2} height={80} label="VO₂ máx. en los últimos 14 meses" />
          </div>
        </Card>
      </Link>
    </div>
  );
}
