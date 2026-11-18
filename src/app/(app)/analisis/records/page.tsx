import Link from "next/link";
import { AnalysisSkeleton } from "@/components/ui/Skeletons";
import { Suspense } from "react";
import { connection } from "next/server";
import { RecordChart } from "@/components/charts/RecordChart";
import { PageHeader } from "@/components/ui/primitives";
import { EFFORT_DISTANCES, type EffortKey } from "@/lib/analysis/best-efforts";
import { getRecordHistory } from "@/lib/db/queries";
import { recordsScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { cap, date, dec } from "@/lib/format";

export const metadata = { title: "Récords · Stride Lab" };

const clock = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(t % 60).padStart(2, "0")}`;
};

export default function RecordsPage({ searchParams }: PageProps<"/analisis/records">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/analisis" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Análisis
      </Link>
      <PageHeader title="Récords" subtitle="Tus mejores marcas, dentro de cualquier carrera." />
      <Suspense fallback={<AnalysisSkeleton />}>
        <Records searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Records({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const records = await recordsScreen(cacheDay());
  const selKey = (EFFORT_DISTANCES.find((d) => d.key === sp.d)?.key ?? null) as EffortKey | null;

  return (
    <div className="stagger flex flex-col gap-4">
      <ul className="flex flex-col gap-2.5">
        {records.map((r) => {
          const active = r.key === selKey;
          return (
            <li key={r.key}>
              <Link
                href={active ? "/analisis/records" : `/analisis/records?d=${r.key}#evolucion`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`card flex min-h-[76px] items-center gap-4 p-4 ${active ? "border-lime" : ""}`}
              >
                <div className="w-[92px] flex-none">
                  <div className="font-display text-[16px] leading-tight font-bold">{r.label}</div>
                  <div className="mt-0.5 text-[11px] text-fg-2">
                    {r.attempts} {r.attempts === 1 ? "carrera" : "carreras"}
                  </div>
                </div>
                {r.best ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="num text-[26px]">{clock(r.best.timeS)}</span>
                        {r.recent && <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-ink">12 MESES</span>}
                      </div>
                      <div className="text-[12px] text-fg-2">
                        {clock(r.best.timeS / (r.m / 1000))} /km · {cap(date(r.best.startAt))}
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className={`flex-none text-fg-3 transition ${active ? "rotate-90" : ""}`}>
                      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </>
                ) : (
                  <p className="flex-1 text-[13px] text-fg-2">Sin datos suficientes: ninguna carrera tiene un tramo continuo de esta distancia.</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {selKey && <Evolution k={selKey} />}

      <p className="text-[12px] leading-relaxed text-fg-2">
        Cada marca es el tramo continuo más rápido de esa distancia dentro de cualquier carrera, con la distancia y el tiempo del reloj.
        Las pausas (más de 15 s sin distancia) parten la carrera: un esfuerzo nunca las cruza. Se descartan esfuerzos más rápidos de
        2:30 /km. Las carreras en periodos de lesión sí cuentan.
      </p>
    </div>
  );
}

async function Evolution({ k }: { k: EffortKey }) {
  const d = EFFORT_DISTANCES.find((x) => x.key === k)!;
  const { points, improvement, injuries, recentRecords, nowMs } = await getRecordHistory(k);
  const records = points.filter((p) => p.isRecord);
  return (
    <section id="evolucion" className="card scroll-mt-6 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">{d.label} · evolución</div>
        {improvement !== null && (
          <span className="text-[12px] text-fg-2">
            Mejora <b className="text-lime-text">{dec(improvement)} %</b> desde el primer récord
          </span>
        )}
      </div>
      {points.length === 0 ? (
        <p className="mt-3 text-[14px] text-fg-2">Sin datos suficientes.</p>
      ) : (
        <>
          <div className="mt-3">
            <RecordChart points={points} bands={injuries.map((i) => ({ startDate: i.startDate, endDate: i.endDate }))} distanceKm={d.m / 1000} nowMs={nowMs} />
          </div>
          <p className="mt-3 text-[12px] text-fg-2">
            {records.length} {records.length === 1 ? "récord" : "récords"} en total
            {recentRecords ? `, ${recentRecords} en los últimos 12 meses` : ", ninguno en los últimos 12 meses"}.
          </p>
        </>
      )}
    </section>
  );
}
