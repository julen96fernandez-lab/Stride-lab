import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RunLineChart } from "@/components/charts/charts";
import { RouteMap } from "@/components/map/RouteMap";
import { CountUp } from "@/components/ui/CountUp";
import { Card } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/RunRow";
import { TypePicker } from "@/components/ui/TypePicker";
import { ZonesCard } from "@/components/ui/ZonesCard";
import { LoadBadge } from "@/components/ui/Load";
import { isSessionType } from "@/lib/analysis/session-type";
import type { Durability } from "@/lib/analysis/durability";
import { getRun } from "@/lib/db/queries";
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
      <Suspense fallback={<div className="card h-[520px] animate-pulse" aria-hidden="true" />}>
        <RunDetail params={params} />
      </Suspense>
    </div>
  );
}

type Run = NonNullable<Awaited<ReturnType<typeof getRun>>>;

async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const data = await getRun(id);
  if (!data) notFound();
  const { run, route, splits, hr, power, durability, zones, prevId, nextId } = data;

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
          <Tag>{run.source === "apple_watch" ? "Apple Watch" : run.source === "strava" ? "Strava" : (run.sourceName ?? "Otra fuente")}</Tag>
          {run.isIndoor && <Tag>Indoor</Tag>}
          {run.isSpecial && <Tag tone="lime">Sesión especial</Tag>}
          <LoadBadge load={run.trainingLoad} />
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

      {/* Tipo de sesión: un toque para cambiarlo */}
      {run.status === "valid" && (
        <TypePicker
          runId={run.id}
          autoType={isSessionType(run.sessionTypeAuto) ? run.sessionTypeAuto : null}
          autoReason={run.sessionTypeReason}
          manualType={isSessionType(run.sessionTypeManual) ? run.sessionTypeManual : null}
        />
      )}

      {/* Mapa */}
      {route ? (
        <section className="card p-2">
          <RouteMap points={route.points} bbox={route.bbox} shape={route.shape} />
        </section>
      ) : (
        <Card>
          <div className="eyebrow">Recorrido</div>
          <p className="mt-2 text-[14px] text-fg-2">{run.isIndoor ? "Carrera en cinta: sin ruta GPS." : "Esta carrera no tiene ruta GPS."}</p>
        </Card>
      )}

      {/* Parciales */}
      <Splits splits={splits} />

      {/* Durabilidad */}
      <DurabilityCard d={durability} />

      {/* Tiempo en zonas y carga */}
      <ZonesCard seconds={run.hrZoneSeconds} load={run.trainingLoad} zones={zones} />

      {/* Pulso y potencia a lo largo de la carrera */}
      {hr && hr.t.length > 1 && (
        <Card>
          <div className="eyebrow">Pulso</div>
          <div className="mt-3">
            <RunLineChart t={hr.t} v={hr.v} unit="ppm" label="Pulso a lo largo de la carrera" />
          </div>
        </Card>
      )}
      {power && power.t.length > 1 && (
        <Card>
          <div className="eyebrow">Potencia</div>
          <div className="mt-3">
            <RunLineChart t={power.t} v={power.v} unit="W" label="Potencia a lo largo de la carrera" />
          </div>
        </Card>
      )}

      {/* Métricas */}
      <Metrics run={run} />

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

function Splits({ splits }: { splits: Run["splits"] }) {
  if (splits.length === 0) {
    return (
      <Card>
        <div className="eyebrow">Parciales por km</div>
        <p className="mt-2 text-[14px] text-fg-2">Sin datos de distancia suficientes para calcularlos.</p>
      </Card>
    );
  }
  const paces = splits.map((s) => s.paceSPerKm).filter((p): p is number => p !== null);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const hasHr = splits.some((s) => s.avgHr !== null);
  const hasElev = splits.some((s) => s.elevationGainM !== null);
  const fastestIdx = splits.find((s) => s.paceSPerKm === fastest)?.idx;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Parciales por km</div>
        <span className="text-[11px] text-fg-2">{splits[0].basis === "samples" ? "Distancia del reloj" : "Distancia del GPS"}</span>
      </div>
      <div className="mt-3 grid grid-cols-[28px_1fr_52px_auto] items-center gap-x-3 gap-y-0 text-[11px] font-semibold tracking-[0.06em] text-fg-3 uppercase">
        <span>Km</span>
        <span>Ritmo</span>
        <span className="text-right">{hasHr ? "FC" : ""}</span>
        <span className="w-[44px] text-right">{hasElev ? "Desn." : ""}</span>
      </div>
      <ol className="mt-1">
        {splits.map((s) => {
          // Barra: más larga = más rápido (escala entre el más lento y el más rápido).
          const w =
            s.paceSPerKm === null ? 0 : slowest === fastest ? 100 : 35 + (65 * (slowest - s.paceSPerKm)) / (slowest - fastest);
          const partial = s.distanceM < 990;
          return (
            <li key={s.idx} className="grid min-h-[34px] grid-cols-[28px_1fr_52px_auto] items-center gap-x-3">
              <span className="num text-[13px] text-fg-2">{partial ? dec(s.distanceM / 1000, 2) : s.idx}</span>
              <div className="relative flex h-[26px] items-center">
                <div
                  className={`absolute inset-y-0 left-0 rounded-lg ${s.idx === fastestIdx ? "bg-lime shadow-[0_0_14px_rgba(200,242,58,0.4)]" : "bg-white/10"}`}
                  style={{ width: `${w}%` }}
                />
                <span className={`num relative pl-2.5 text-[15px] ${s.idx === fastestIdx ? "text-lime-ink" : ""}`}>{pace(s.paceSPerKm)}</span>
              </div>
              <span className="num text-right text-[14px] text-fg-2">{s.avgHr === null ? (hasHr ? DASH : "") : int(s.avgHr)}</span>
              <span className="w-[44px] text-right text-[12px] text-fg-2">
                {s.elevationGainM === null ? (hasElev ? DASH : "") : `+${int(s.elevationGainM)}`}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function DurabilityCard({ d }: { d: Durability | null }) {
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
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Durabilidad</div>
        <span className="text-[11px] text-fg-2">1.ª mitad frente a 2.ª</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[d.first, d.second].map((h, i) => (
          <div key={i} className="rounded-2xl border border-line bg-black/20 p-3.5">
            <div className="text-[12px] text-fg-2">{i === 0 ? "Primera mitad" : "Segunda mitad"}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="num text-[26px]">{pace(h.paceSPerKm)}</span>
              <span className="text-[11px] text-fg-2">/km</span>
            </div>
            <div className="mt-1 text-[13px] text-fg-2">{h.avgHr === null ? `${DASH} ppm` : `${int(h.avgHr)} ppm`}</div>
          </div>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <dt className="eyebrow">Ritmo 2.ª mitad</dt>
          <dd className="mt-1.5 text-[15px] font-semibold">{deltaText}</dd>
        </div>
        <div>
          <dt className="eyebrow">Desacople FC/ritmo</dt>
          <dd className={`num mt-1.5 text-[22px] ${d.decouplingPct === null ? "text-fg-3" : d.decouplingPct > 5 ? "" : "text-lime"}`}>
            {d.decouplingPct === null ? DASH : `${d.decouplingPct > 0 ? "+" : ""}${dec(d.decouplingPct)} %`}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] leading-relaxed text-fg-2">
        Desacople: cuánto empeora la relación velocidad/pulso en la segunda mitad. Por debajo de ~5 % suele considerarse buena
        resistencia aeróbica.
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
