import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ManualRunForm } from "@/components/manual/ManualRunForm";
import { emptyValues } from "@/lib/manual/form-values";
import { PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Añadir carrera · Stride Lab" };

export default function NewRunPage() {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <Link href="/actividad" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Actividad
      </Link>
      <PageHeader title="Añadir carrera" subtitle="Sin reimportar el zip de Salud. Si luego lo importas, la del zip la sustituye." />
      <Suspense fallback={<div className="card h-[520px] animate-pulse" aria-hidden="true" />}>
        <NewForm />
      </Suspense>
    </div>
  );
}

/** Fecha y hora de ahora (Madrid) como valores por defecto: se calculan al abrir la página. */
async function NewForm() {
  await connection();
  return <ManualRunForm initial={emptyValues()} />;
}
