import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui/primitives";
import { checkRun, latestImport } from "@/lib/import/status";
import { ImportFlow } from "./ImportFlow";

export const metadata = { title: "Importar · Stride Lab" };

async function Flow() {
  await connection();
  const last = await latestImport();
  const check = last?.status === "done" ? await checkRun() : null;
  return <ImportFlow initial={last} initialCheck={check} />;
}

export default function ImportPage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <Link href="/perfil" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Perfil
      </Link>
      <PageHeader title="Importar" subtitle="Tu export de Apple Health." />
      <Link href="/actividad/nueva" className="card flex min-h-[64px] items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-lime text-[20px] font-bold text-lime-ink" aria-hidden="true">
          +
        </span>
        <span className="flex-1">
          <span className="block font-display text-[16px] font-bold">Añadir carrera</span>
          <span className="block text-[12px] text-fg-2">A mano o con un .gpx, .tcx o .fit, sin reimportar el zip</span>
        </span>
      </Link>
      <Suspense fallback={<div className="card h-[260px]" aria-hidden="true" />}>
        <Flow />
      </Suspense>
    </div>
  );
}
