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
      <Suspense fallback={<div className="card h-[260px]" aria-hidden="true" />}>
        <Flow />
      </Suspense>
    </div>
  );
}
