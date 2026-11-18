import Link from "next/link";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ManualRunForm } from "@/components/manual/ManualRunForm";
import { PageHeader } from "@/components/ui/primitives";
import { getManualForEdit } from "@/lib/db/queries";

export const metadata = { title: "Editar carrera · Stride Lab" };

export default function EditRunPage({ params }: PageProps<"/actividad/[id]/editar">) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader title="Editar carrera" subtitle="Solo se pueden editar las carreras añadidas a mano." />
      <Suspense fallback={<ProfileSkeleton rows={6} />}>
        <EditForm params={params} />
      </Suspense>
    </div>
  );
}

async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const run = await getManualForEdit(id);
  if (!run) notFound();
  return (
    <>
      <Link href={`/actividad/${run.id}`} className="-mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Volver a la carrera
      </Link>
      <ManualRunForm id={run.id} initial={run.values} existingFile={run.existingFile} />
    </>
  );
}
