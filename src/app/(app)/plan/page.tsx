import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { planScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { SHIFT_META, dayNum, ymdOf } from "@/lib/plan/shifts";

export const metadata = { title: "Plan · Stride Lab" };

export default function PlanPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Plan" subtitle="Tu ciclo de turnos de 5 semanas." />
      </div>
      <Suspense fallback={<ProfileSkeleton rows={6} />}>
        <PlanData />
      </Suspense>
    </div>
  );
}

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", ...o }).format(new Date(`${ymd}T00:00:00Z`));
/** «23–29 nov» o «28 dic – 3 ene» */
function range(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${fmt(start, { day: "numeric" })}–${fmt(end, { day: "numeric", month: "short" })}` : `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short" })}`;
}

async function PlanData() {
  await connection();
  const { anchor, today, weeks } = await planScreen(cacheDay());
  if (!anchor) {
    return (
      <Card>
        <div className="eyebrow">Sin ciclo de turnos</div>
        <p className="mt-3 text-[14px] text-fg-2">Indica en Perfil el lunes en que empieza un bloque de tardes y aquí verás tus próximas semanas.</p>
        <Link href="/perfil#turnos" className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-lime px-4 text-[14px] font-semibold text-lime-ink">
          Ir a Perfil
        </Link>
      </Card>
    );
  }
  const current = weeks[0];
  const todayDay = dayNum(today)!;
  const left = current.startDay + 6 - todayDay;
  return (
    <>
      <section className="card card-hero p-5" aria-label="Esta semana">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Esta semana · {range(current.start, current.end)}</div>
          <ShiftPill kind={current.kind} />
        </div>
        <p className="relative mt-3 text-[15px] leading-relaxed">{SHIFT_META[current.kind].hint}</p>
        <p className="relative mt-1 text-[12px] text-fg-2">
          {left === 0 ? "Último día del bloque." : `Quedan ${left} ${left === 1 ? "día" : "días"} de este bloque.`} Semana {current.pos + 1} de 5 del ciclo.
        </p>
      </section>

      <section className="card p-5" aria-label="Próximas semanas">
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Próximas semanas</div>
          <Link href="/perfil#turnos" className="-my-3 -mr-2 inline-flex min-h-[44px] items-center px-2 text-[12px] text-fg-2">
            Cambiar ciclo
          </Link>
        </div>
        <ol className="mt-2 divide-y divide-line">
          {weeks.slice(1).map((w) => (
            <li key={w.start} className="flex min-h-[52px] items-center justify-between gap-3 py-2">
              <div>
                <div className="text-[15px] font-semibold">{range(w.start, w.end)}</div>
                <div className="text-[12px] text-fg-2">
                  {fmt(w.start, { year: "numeric" }) !== fmt(today, { year: "numeric" }) ? `${fmt(w.start, { year: "numeric" })} · ` : ""}semana {w.pos + 1} de 5
                </div>
              </div>
              <ShiftPill kind={w.kind} />
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] text-fg-2">
          Calculado desde el lunes {fmt(anchor, { day: "numeric", month: "long", year: "numeric" })} (inicio de un bloque de tardes). Hoy:{" "}
          {fmt(ymdOf(todayDay), { weekday: "long", day: "numeric", month: "long" })}.
        </p>
      </section>
    </>
  );
}

function ShiftPill({ kind }: { kind: keyof typeof SHIFT_META }) {
  const c = SHIFT_META[kind].color;
  return (
    <span
      className="relative rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}
    >
      {SHIFT_META[kind].label}
    </span>
  );
}
