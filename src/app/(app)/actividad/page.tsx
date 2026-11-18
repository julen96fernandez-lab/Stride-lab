import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ButtonLink, Card, PageHeader } from "@/components/ui/primitives";
import { RunRow } from "@/components/ui/RunRow";
import { SessionIcon } from "@/components/ui/SessionType";
import { SESSION_TYPES, TYPE_META, isSessionType } from "@/lib/analysis/session-type";
import { listRuns, type RunListItem } from "@/lib/db/queries";
import { TZ, cap, km } from "@/lib/format";

export const metadata = { title: "Actividad · Stride Lab" };

export default function ActivityPage({ searchParams }: PageProps<"/actividad">) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader
          title="Actividad"
          subtitle="Todas tus carreras válidas."
          aside={
            <Link
              href="/actividad/nueva"
              className="inline-flex min-h-[44px] flex-none items-center gap-1.5 rounded-full bg-lime px-4 text-[14px] font-semibold text-lime-ink active:scale-[0.98]"
            >
              <span aria-hidden="true" className="text-[18px] leading-none">+</span> Añadir carrera
            </Link>
          }
        />
      </div>
      <Suspense fallback={<div className="card h-[480px] animate-pulse" aria-hidden="true" />}>
        <RunList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const monthKey = (d: Date) =>
  cap(new Intl.DateTimeFormat("es-ES", { timeZone: TZ, month: "long", year: "numeric" }).format(d));

async function RunList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const filter = isSessionType(sp.tipo) ? sp.tipo : null;
  const { items, counts, hiddenDuplicates, hiddenInvalid } = await listRuns(filter);
  const total = counts.reduce((a, c) => a + c.runs, 0);

  if (total === 0) {
    return (
      <Card>
        <div className="eyebrow">Sin carreras</div>
        <p className="mt-3 text-[15px] leading-relaxed text-fg-2">Importa tu export de Apple Health para verlas aquí.</p>
        <div className="mt-5">
          <ButtonLink href="/perfil/importar" variant="ghost">
            Ir a importar
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const groups: { key: string; runs: RunListItem[] }[] = [];
  for (const r of items) {
    const k = monthKey(r.startAt);
    const g = groups.at(-1);
    if (g && g.key === k) g.runs.push(r);
    else groups.push({ key: k, runs: [r] });
  }

  const chip = (active: boolean) =>
    `flex min-h-[40px] flex-none items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition ${
      active ? "border-lime bg-lime text-lime-ink shadow-[0_0_16px_rgba(200,242,58,0.35)]" : "border-line-strong bg-ov-1 text-fg"
    }`;

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros por tipo */}
      <nav aria-label="Filtrar por tipo" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
        <div className="flex w-max gap-2 pb-1">
          <Link href="/actividad" scroll={false} aria-current={!filter ? "true" : undefined} className={chip(!filter)}>
            Todas <span className="opacity-70">{total}</span>
          </Link>
          {SESSION_TYPES.map((t) => {
            const c = counts.find((x) => x.type === t)!;
            const active = filter === t;
            return (
              <Link
                key={t}
                href={`/actividad?tipo=${t}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`${chip(active)} ${c.runs === 0 && !active ? "opacity-45" : ""}`}
              >
                <span style={{ color: active ? undefined : TYPE_META[t].color }} className="flex">
                  <SessionIcon type={t} size={15} />
                </span>
                {TYPE_META[t].label} <span className="opacity-70">{c.runs}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <p className="text-[13px] text-fg-2">
        {filter
          ? `${items.length} ${items.length === 1 ? "carrera" : "carreras"} de ${TYPE_META[filter].label.toLowerCase()} · ${km(
              items.reduce((a, r) => a + (r.distanceM ?? 0), 0),
              0,
            )} km`
          : `${items.length} carreras`}
        {!filter &&
          hiddenDuplicates + hiddenInvalid > 0 &&
          ` · ocultas: ${hiddenDuplicates} duplicadas de Strava y ${hiddenInvalid} de menos de 0,5 km`}
      </p>

      {items.length === 0 && (
        <Card>
          <p className="text-[14px] text-fg-2">Ninguna carrera de este tipo todavía.</p>
        </Card>
      )}

      <div className="stagger flex flex-col gap-4">
        {groups.map((g) => {
          const sum = g.runs.reduce((a, r) => a + (r.distanceM ?? 0), 0);
          return (
            <section key={g.key} className="card px-4 py-3">
              <div className="flex items-baseline justify-between px-1 pt-1 pb-1">
                <h2 className="font-display text-[17px] font-bold tracking-[-0.01em]">{g.key}</h2>
                <span className="text-[12px] text-fg-2">
                  {g.runs.length} · {km(sum, 1)} km
                </span>
              </div>
              <ul className="divide-y divide-line">
                {g.runs.map((r) => (
                  <li key={r.id}>
                    <RunRow run={r} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
