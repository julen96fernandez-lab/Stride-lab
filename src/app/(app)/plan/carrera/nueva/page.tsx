import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { RaceForm } from "@/components/race/RaceForm";
import { planScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";

export const metadata = { title: "Nueva carrera objetivo · Stride Lab" };

export default function NewRacePage() {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/plan" className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-fg-2">
        ‹ Plan
      </Link>
      <PageHeader title="Carrera objetivo" subtitle="El tiempo propuesto es tu predicción de Plan." />
      <Suspense fallback={<ProfileSkeleton rows={6} />}>
        <NewRaceForm />
      </Suspense>
    </div>
  );
}

async function NewRaceForm() {
  await connection();
  const today = cacheDay();
  const { predictions } = await planScreen(today);
  const inFour = new Date(Date.parse(`${today}T00:00:00Z`) + 28 * 86_400_000).toISOString().slice(0, 10);
  return (
    <RaceForm
      initial={{ name: "", date: inFour, distanceKey: "10k", distanceKm: "", startTime: "", target: "", hasProfile: false }}
      preds={predictions.now}
      sources={predictions.sources}
      longestM={predictions.longestM}
    />
  );
}
