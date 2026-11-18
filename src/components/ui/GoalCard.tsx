import Link from "next/link";
import type { GoalProgress } from "@/lib/analysis/periods";

const km1 = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });

/** Anillo de progreso (SVG): pista neutra y arco en lima; el número va dentro. */
export function Ring({ pct, size = 84 }: { pct: number; size?: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true" className="flex-none -rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" stroke="var(--ov-2)" strokeWidth="8" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="var(--chart-line)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.001, pct) * c} ${c}`}
      />
    </svg>
  );
}

function Row({ title, g, doneKm }: { title: string; g: GoalProgress | null; doneKm: number }) {
  if (!g) return null;
  const pct = Math.round(g.pct * 100);
  return (
    <div className="flex items-center gap-4" role="group" aria-label={`${title}: ${km1(g.doneKm)} de ${km1(g.goalKm)} km`}>
      <div className="relative">
        <Ring pct={g.pct} />
        <span className="num absolute inset-0 flex items-center justify-center text-[17px]">{pct}%</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">{title}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="num text-[26px]">{km1(doneKm)}</span>
          <span className="text-[13px] text-fg-2">/ {km1(g.goalKm)} km</span>
        </div>
        <div className="mt-0.5 text-[12px] text-fg-2">
          {g.remainingKm > 0 ? (
            <>
              Faltan <b className="text-fg">{km1(g.remainingKm)} km</b> · {km1(g.kmPerDay)} km/día en {g.daysLeft}{" "}
              {g.daysLeft === 1 ? "día" : "días"}
            </>
          ) : (
            <b className="text-lime-text">Objetivo cumplido</b>
          )}
        </div>
      </div>
    </div>
  );
}

/** Objetivos de la semana y del mes en curso (Inicio). */
export function GoalCard({
  week,
  month,
  weekKm,
  monthKm,
}: {
  week: GoalProgress | null;
  month: GoalProgress | null;
  weekKm: number;
  monthKm: number;
}) {
  if (!week && !month) {
    return (
      <Link href="/perfil#objetivos" className="card flex min-h-[64px] items-center justify-between p-5">
        <div>
          <div className="eyebrow">Objetivos</div>
          <p className="mt-1 text-[14px] text-fg-2">Sin objetivos activos. Ponlos en Perfil.</p>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="text-fg-3">
          <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </Link>
    );
  }
  return (
    <section className="card flex flex-col gap-4 p-5">
      <Row title="Objetivo semanal" g={week} doneKm={weekKm} />
      {week && month && <div className="h-px bg-line" />}
      <Row title="Objetivo mensual" g={month} doneKm={monthKm} />
    </section>
  );
}
