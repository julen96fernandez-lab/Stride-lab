import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { SessionForm } from "@/components/plan/SessionForm";
import { planScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { isMineKind, mineKindOf } from "@/lib/plan/mine";

export const metadata = { title: "Sesión prevista · Stride Lab" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function NewSessionPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<ProfileSkeleton rows={6} />}>
        <NewSession searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewSession({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const today = cacheDay();
  const volver = one(sp.volver) === "inicio" ? "inicio" : null;
  const semana = one(sp.semana);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.fecha)) ? one(sp.fecha) : today;
  const tipo = one(sp.tipo);

  const suggestion = semana ? (await planScreen(today)).sessions.find((s) => s.start === semana) ?? null : null;
  const back = (
    <Link href={volver ? "/" : "/plan"} className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-fg-2">
      ‹ {volver ? "Inicio" : "Plan"}
    </Link>
  );
  return (
    <>
      {back}
      <PageHeader
        title={suggestion ? "Editar la sugerida" : volver ? "Voy a correr hoy" : "Añadir sesión"}
        subtitle={suggestion ? "Al guardar pasa a ser tuya y sustituye a la sugerencia de esa semana." : "Lo que pones manda sobre la sugerencia."}
      />
      {suggestion && (
        <section className="card p-4 text-[14px]" aria-label="Sugerencia">
          <div className="eyebrow">Sugerencia de la app</div>
          <div className="mt-1.5">
            <b>{suggestion.label}</b> <span className="text-fg-2">· {suggestion.dayLabel}</span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-fg-2">{suggestion.reason}</p>
        </section>
      )}
      <SessionForm
        suggestionWeek={suggestion?.start ?? null}
        initial={{
          date: suggestion?.day ?? fecha,
          kind: suggestion ? mineKindOf(suggestion.session) : isMineKind(tipo) ? tipo : "suave",
          distanceKm: "",
          duration: "",
          note: "",
          replacesWeek: suggestion?.start ?? null,
          volver,
        }}
      />
    </>
  );
}
