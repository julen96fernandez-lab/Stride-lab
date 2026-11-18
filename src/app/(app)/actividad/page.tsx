import { Suspense } from "react";
import Link from "next/link";
import { ChoicePanel, ChoiceProvider, ChoiceSelector } from "@/components/ui/Choice";
import { connection } from "next/server";
import { ButtonLink, Card, PageHeader } from "@/components/ui/primitives";
import { RunRow } from "@/components/ui/RunRow";
import { SessionIcon } from "@/components/ui/SessionType";
import { SESSION_TYPES, TYPE_META, isSessionType, type SessionType } from "@/lib/analysis/session-type";
import { type RunListItem } from "@/lib/db/queries";
import { activityScreen } from "@/lib/db/screens";
import { ActivitySkeleton } from "@/components/ui/Skeletons";
import { cacheDay } from "@/lib/cache/tags";
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
              className="inline-flex min-h-[44px] flex-none items-center gap-1.5 rounded-full bg-lime px-4 text-[14px] font-semibold text-lime-ink"
            >
              <span aria-hidden="true" className="text-[18px] leading-none">+</span> Añadir carrera
            </Link>
          }
        />
      </div>
      <Suspense fallback={<ActivitySkeleton />}>
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
  const initial = isSessionType(sp.tipo) || sp.tipo === "con_nota" ? (sp.tipo as string) : "todas";
  const { items, counts, hiddenDuplicates, hiddenInvalid } = await activityScreen(cacheDay());
  const total = counts.reduce((a, c) => a + c.runs, 0);
  const withFeeling = items.filter((r) => r.hasFeeling);

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

  // Todas las listas llegan ya preparadas: el filtro cambia al instante, sin ir al servidor.
  return (
    <ChoiceProvider initial={{ tipo: initial }} defaults={{ tipo: "todas" }}>
      <div className="flex flex-col gap-4">
        <nav aria-label="Filtrar por tipo">
          <ChoiceSelector
            name="tipo"
            variant="chips"
            label="Filtrar por tipo"
            items={[
              {
                key: "todas",
                label: (
                  <>
                    Todas <span className="opacity-70">{total}</span>
                  </>
                ),
              },
              {
                key: "con_nota",
                label: (
                  <span className={`flex items-center gap-1.5 ${withFeeling.length === 0 ? "opacity-45" : ""}`}>
                    <span aria-hidden="true">✎</span> Con nota <span className="opacity-70">{withFeeling.length}</span>
                  </span>
                ),
              },
              ...SESSION_TYPES.map((t) => {
                const c = counts.find((x) => x.type === t)!;
                return {
                  key: t,
                  label: (
                    <span className={`flex items-center gap-1.5 ${c.runs === 0 ? "opacity-45" : ""}`}>
                      <span style={{ color: TYPE_META[t].color }} className="flex">
                        <SessionIcon type={t} size={15} />
                      </span>
                      {TYPE_META[t].label} <span className="opacity-70">{c.runs}</span>
                    </span>
                  ),
                };
              }),
            ]}
          />
        </nav>
        <ChoicePanel when={{ tipo: "con_nota" }}>
          <FilteredRuns items={withFeeling} filter={null} label="con sensación" hidden={0} hiddenDuplicates={0} hiddenInvalid={0} />
        </ChoicePanel>
        {(["todas", ...SESSION_TYPES] as const).map((f) => (
          <ChoicePanel key={f} when={{ tipo: f }}>
            <FilteredRuns
              items={f === "todas" ? items : items.filter((r) => r.type === f)}
              filter={f === "todas" ? null : f}
              hidden={f === "todas" ? hiddenDuplicates + hiddenInvalid : 0}
              hiddenDuplicates={hiddenDuplicates}
              hiddenInvalid={hiddenInvalid}
            />
          </ChoicePanel>
        ))}
      </div>
    </ChoiceProvider>
  );
}

function FilteredRuns({
  items,
  filter,
  label,
  hidden,
  hiddenDuplicates,
  hiddenInvalid,
}: {
  items: RunListItem[];
  filter: SessionType | null;
  /** texto para filtros que no son un tipo («con sensación») */
  label?: string;
  hidden: number;
  hiddenDuplicates: number;
  hiddenInvalid: number;
}) {
  const groups: { key: string; runs: RunListItem[] }[] = [];
  for (const r of items) {
    const k = monthKey(r.startAt);
    const g = groups.at(-1);
    if (g && g.key === k) g.runs.push(r);
    else groups.push({ key: k, runs: [r] });
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-2">
        {filter
          ? `${items.length} ${items.length === 1 ? "carrera" : "carreras"} de ${TYPE_META[filter].label.toLowerCase()} · ${km(
              items.reduce((a, r) => a + (r.distanceM ?? 0), 0),
              0,
            )} km`
          : `${items.length} ${items.length === 1 ? "carrera" : "carreras"}${label ? ` ${label}` : ""}`}
        {hidden > 0 && ` · ocultas: ${hiddenDuplicates} duplicadas de Strava y ${hiddenInvalid} de menos de 0,5 km`}
      </p>

      {items.length === 0 && (
        <Card>
          <p className="text-[14px] text-fg-2">
            {label ? "Ninguna carrera con sensación todavía: añádela en el detalle de una carrera." : "Ninguna carrera de este tipo todavía."}
          </p>
        </Card>
      )}

      <div className="stagger flex flex-col gap-4">
        {groups.map((g, gi) => {
          const sum = g.runs.reduce((a, r) => a + (r.distanceM ?? 0), 0);
          return (
            <section key={g.key} className={`card px-4 py-3 ${gi > 1 ? "cv-auto" : ""}`}>
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
