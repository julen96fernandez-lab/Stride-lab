import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RunExplorer } from "@/components/charts/RunExplorer";
import { ManualActions } from "@/components/manual/ManualActions";
import { CountUp } from "@/components/ui/CountUp";
import { Card } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/RunRow";
import { TypePicker } from "@/components/ui/TypePicker";
import { FeelingsCard } from "@/components/feelings/FeelingsCard";
import { ZonesCard } from "@/components/ui/ZonesCard";
import { SummaryCard } from "@/components/detail/SummaryCard";
import { SameRouteCard } from "@/components/detail/SameRouteCard";
import { LoadBadge } from "@/components/ui/Load";
import { isSessionType } from "@/lib/analysis/session-type";
import type { Durability } from "@/lib/analysis/durability";
import { decouplingLabel, type DecouplingCheck } from "@/lib/analysis/efficiency";
import { runScreen } from "@/lib/db/screens";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { cacheDay } from "@/lib/cache/tags";
import { DASH, cap, date, dec, duration, int, pace } from "@/lib/format";

export const metadata = { title: "Carrera · Stride Lab" };

export default function RunPage({ params }: PageProps<"/actividad/[id]">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/actividad" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Actividad
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <RunDetail params={params} />
      </Suspense>
    </div>
  );
}

type Run = NonNullable<Awaited<ReturnType<typeof runScreen>>>;

async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await runScreen(id, cacheDay()) : null;
  if (!data) notFound();
  const { run, route, durability, decoupling, zones, explorer, prevId, nextId, feeling, summary, sameRoute } = data;

  return (
    <div className="stagger flex flex-col gap-4">
      {/* Cabecera */}
      <header>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
          <span>
            {cap(date(run.startAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))} ·{" "}
            {date(run.startAt, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Tag tone={run.source === "manual" ? "lime" : undefined}>
            {run.source === "manual" ? "Manual" : run.source === "apple_watch" ? "Apple Watch" : run.source === "strava" ? "Strava" : (run.sourceName ?? "Otra fuente")}
          </Tag>
          {run.isIndoor && <Tag>Indoor</Tag>}
          {run.isSpecial && <Tag tone="lime">Sesión especial</Tag>}
          <LoadBadge load={run.trainingLoad} estimated={run.loadEstimated} />
          {run.status !== "valid" && <Tag>{run.status === "duplicate" ? "Duplicada" : "No válida"}</Tag>}
        </div>
      </header>

      {/* Números principales */}
      <section className="card card-hero p-5">
        <div className="eyebrow">Distancia</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="num text-[64px]">{run.distanceM === null ? DASH : <CountUp value={run.distanceM / 1000} decimals={2} />}</span>
          {run.distanceM !== null && <span className="text-[15px] text-fg-2">km</span>}
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <Big label="Tiempo" value={duration(run.durationS)} />
          <Big label="Ritmo" value={pace(run.avgPaceSPerKm)} unit="/km" />
          <Big label="FC media" value={run.avgHr === null ? DASH : int(run.avgHr)} unit={run.avgHr === null ? undefined : "ppm"} />
        </div>
        {run.isSpecial && (
          <p className="relative mt-4 text-[12px] text-fg-2">Ritmo medio por encima de 8:00 /km: no cuenta en los ritmos medios.</p>
        )}
      </section>

      {/* Resumen en lenguaje claro (reglas, sin IA) */}
      <SummaryCard lines={summary} />

      {/* Tipo de sesión: un toque para cambiarlo */}
      {run.status === "valid" && (
        <TypePicker
          runId={run.id}
          autoType={isSessionType(run.sessionTypeAuto) ? run.sessionTypeAuto : null}
          autoReason={run.sessionTypeReason}
          manualType={isSessionType(run.sessionTypeManual) ? run.sessionTypeManual : null}
        />
      )}

      {/* Sensaciones: se guardan al tocar (tabla aparte, no se pierden al reprocesar) */}
      {run.status === "valid" && <FeelingsCard key={run.id} runId={run.id} initial={feeling} />}

      {/* Mapa, gráficos sincronizados y parciales */}
      {!route && (
        <Card>
          <div className="eyebrow">Recorrido</div>
          <p className="mt-2 text-[14px] text-fg-2">{run.isIndoor ? "Carrera en cinta: sin ruta GPS." : "Esta carrera no tiene ruta GPS."}</p>
        </Card>
      )}
      <RunExplorer data={explorer} route={route} />

      {/* Misma ruta: solo con al menos 2 carreras anteriores por el mismo recorrido */}
      {sameRoute && <SameRouteCard rows={sameRoute} />}

      {/* Durabilidad */}
      <DurabilityCard d={durability} check={decoupling} />

      {/* Tiempo en zonas y carga */}
      <ZonesCard seconds={run.hrZoneSeconds} load={run.trainingLoad} zones={zones} estimated={run.loadEstimated} durationS={run.durationS} />

      {/* Métricas */}
      <Metrics run={run} />

      {run.source === "manual" && <ManualActions id={run.id} />}

      <nav className="grid grid-cols-2 gap-3" aria-label="Otras carreras">
        {prevId ? (
          <Link href={`/actividad/${prevId}`} className="card flex min-h-[52px] items-center justify-center text-[14px] font-semibold text-fg-2">
            ← Anterior
          </Link>
        ) : (
          <span />
        )}
        {nextId ? (
          <Link href={`/actividad/${nextId}`} className="card flex min-h-[52px] items-center justify-center text-[14px] font-semibold text-fg-2">
            Siguiente →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={`num text-[24px] ${value === DASH ? "text-fg-3" : ""}`}>{value}</span>
        {unit && <span className="text-[11px] text-fg-2">{unit}</span>}
      </div>
    </div>
  );
}

function DurabilityCard({ d, check }: { d: Durability | null; check: DecouplingCheck }) {
  if (!d) {
    return (
      <Card>
        <div className="eyebrow">Durabilidad</div>
        <p className="mt-2 text-[14px] text-fg-2">Sin datos suficientes para comparar las dos mitades.</p>
      </Card>
    );
  }
  const delta = Math.round(d.paceDeltaS);
  const deltaText = delta === 0 ? "Mismo ritmo" : delta > 0 ? `+${delta} s/km más lenta` : `${-delta} s/km más rápida`;
  // El desacople solo se muestra en Rodaje / Tirada larga con pulso y ritmo estable.
  const showDec = check.ok && d.decouplingPct !== null;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">{showDec ? "Desacople aeróbico" : "Durabilidad"}</div>
        <span className="text-[11px] text-fg-2">1.ª mitad frente a 2.ª</span>
      </div>
      {showDec && (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className={`num text-[40px] ${d.decouplingPct! <= 5 ? "text-lime-text" : ""}`}>
              {`${d.decouplingPct! > 0 ? "+" : d.decouplingPct! < 0 ? "−" : ""}${dec(Math.abs(d.decouplingPct!))}`}
            </span>
            <span className="text-[15px] text-fg-2">%</span>
          </div>
          <p className="mt-1 text-[14px] leading-snug">{decouplingLabel(d.decouplingPct!)}</p>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[d.first, d.second].map((h, i) => (
          <div key={i} className="rounded-2xl border border-line bg-inset p-3.5">
            <div className="text-[12px] text-fg-2">{i === 0 ? "Primera mitad" : "Segunda mitad"}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="num text-[26px]">{pace(h.paceSPerKm)}</span>
              <span className="text-[11px] text-fg-2">/km</span>
            </div>
            <div className="mt-1 text-[13px] text-fg-2">{h.avgHr === null ? `${DASH} ppm` : `${int(h.avgHr)} ppm`}</div>
          </div>
        ))}
      </div>
      <dl className="mt-4">
        <dt className="eyebrow">Ritmo 2.ª mitad</dt>
        <dd className="mt-1.5 text-[15px] font-semibold">{deltaText}</dd>
      </dl>
      <p className="mt-3 text-[12px] leading-relaxed text-fg-2">
        {showDec
          ? "Desacople: cuánto empeora la relación velocidad/pulso de la primera a la segunda mitad. Si el pulso sube para mantener el mismo ritmo, el % sube. Por debajo de ~5 % suele indicar buena resistencia aeróbica a ese ritmo."
          : `Sin desacople: ${check.ok ? "falta el pulso de alguna mitad." : check.reason}`}
      </p>
    </Card>
  );
}

function Metrics({ run }: { run: Run["run"] }) {
  const groups: { title: string; items: [string, string, string?][] }[] = [
    {
      title: "Potencia y técnica",
      items: [
        ["Potencia media", run.avgPowerW === null ? DASH : int(run.avgPowerW), "W"],
        ["Cadencia", run.cadenceSpm === null ? DASH : int(run.cadenceSpm), "pasos/min"],
        ["Zancada", run.avgStrideM === null ? DASH : dec(run.avgStrideM, 2), "m"],
        ["Oscilación vertical", run.avgVerticalOscCm === null ? DASH : dec(run.avgVerticalOscCm), "cm"],
        ["Contacto con el suelo", run.avgGroundContactMs === null ? DASH : int(run.avgGroundContactMs), "ms"],
        ["Velocidad media", run.avgSpeedMps === null ? DASH : dec(run.avgSpeedMps * 3.6), "km/h"],
      ],
    },
    {
      title: "Esfuerzo y entorno",
      items: [
        ["FC máxima", run.maxHr === null ? DASH : int(run.maxHr), "ppm"],
        ["Desnivel positivo", run.elevationGainM === null ? DASH : int(run.elevationGainM), "m"],
        ["Temperatura", run.temperatureC === null ? DASH : dec(run.temperatureC), "°C"],
        ["Humedad", run.humidityPct === null ? DASH : int(run.humidityPct), "%"],
        ["Energía activa", run.activeEnergyKcal === null ? DASH : int(run.activeEnergyKcal), "kcal"],
        ["Pasos", run.steps === null ? DASH : int(run.steps)],
      ],
    },
  ];
  return (
    <>
      {groups.map((g) => (
        <Card key={g.title}>
          <div className="eyebrow">{g.title}</div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
            {g.items.map(([label, value, unit]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[12px] text-fg-2">{label}</dt>
                <dd className="mt-1 flex items-baseline gap-1">
                  <span className={`num text-[22px] ${value === DASH ? "text-fg-3" : ""}`}>{value}</span>
                  {unit && value !== DASH && <span className="text-[11px] text-fg-2">{unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </>
  );
}
