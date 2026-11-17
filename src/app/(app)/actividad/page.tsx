import { Suspense } from "react";
import { connection } from "next/server";
import { ButtonLink, Card, PageHeader } from "@/components/ui/primitives";
import { RunRow } from "@/components/ui/RunRow";
import { listRuns, type RunListItem } from "@/lib/db/queries";
import { TZ, cap, km } from "@/lib/format";

export const metadata = { title: "Actividad · Stride Lab" };

export default function ActivityPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Actividad" subtitle="Todas tus carreras válidas." />
      </div>
      <Suspense fallback={<div className="card h-[480px] animate-pulse" aria-hidden="true" />}>
        <RunList />
      </Suspense>
    </div>
  );
}

const monthKey = (d: Date) =>
  cap(new Intl.DateTimeFormat("es-ES", { timeZone: TZ, month: "long", year: "numeric" }).format(d));

async function RunList() {
  await connection();
  const { items, hiddenDuplicates, hiddenInvalid } = await listRuns();

  if (items.length === 0) {
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

  return (
    <div className="stagger flex flex-col gap-4">
      <p className="text-[13px] text-fg-2">
        {items.length} carreras
        {hiddenDuplicates + hiddenInvalid > 0 &&
          ` · ocultas: ${hiddenDuplicates} duplicadas de Strava y ${hiddenInvalid} de menos de 0,5 km`}
      </p>
      {groups.map((g) => {
        const total = g.runs.reduce((a, r) => a + (r.distanceM ?? 0), 0);
        return (
          <section key={g.key} className="card px-4 py-3">
            <div className="flex items-baseline justify-between px-1 pt-1 pb-1">
              <h2 className="font-display text-[17px] font-bold tracking-[-0.01em]">{g.key}</h2>
              <span className="text-[12px] text-fg-2">
                {g.runs.length} · {km(total, 1)} km
              </span>
            </div>
            <ul className="divide-y divide-white/6">
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
  );
}
