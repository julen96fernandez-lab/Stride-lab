import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { SessionForm } from "@/components/plan/SessionForm";
import { db } from "@/lib/db/client";
import { getMine } from "@/lib/plan/plan-db";
import { durationField, isMineKind } from "@/lib/plan/mine";
import { fmtDay } from "@/lib/plan/weekly";

export const metadata = { title: "Sesión prevista · Stride Lab" };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/plan" className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-fg-2">
        ‹ Plan
      </Link>
      <Suspense fallback={<ProfileSkeleton rows={6} />}>
        <SessionData params={params} />
      </Suspense>
    </div>
  );
}

async function SessionData({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const m = await getMine(db(), id);
  if (!m || !isMineKind(m.kind)) notFound();
  return (
    <>
      <PageHeader title="Tu sesión" subtitle={`Puesta por mí · ${fmtDay(m.date)}${m.replacesWeek ? " · sustituye a la sugerida" : ""}`} />
      <SessionForm
        initial={{
          id: m.id,
          date: m.date,
          kind: m.kind,
          distanceKm: m.distanceM !== null ? String(m.distanceM / 1000).replace(".", ",") : "",
          duration: durationField(m.durationS),
          note: m.note ?? "",
          replacesWeek: m.replacesWeek,
        }}
      />
    </>
  );
}
