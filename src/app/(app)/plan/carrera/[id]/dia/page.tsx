import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { RaceDay } from "@/components/race/RaceDay";
import { planScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { isStrategy } from "@/lib/race/pacing";

export const metadata = { title: "Día de carrera · Stride Lab" };

export default function RaceDayPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<ProfileSkeleton rows={10} />}>
        <Data params={params} />
      </Suspense>
    </div>
  );
}

async function Data({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { races } = await planScreen(cacheDay());
  const r = races.find((x) => x.id === id);
  if (!r) notFound();
  return (
    <>
      <Link href={`/plan/carrera/${r.id}`} className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-fg-2">
        ‹ {r.name}
      </Link>
      <RaceDay
        name={r.name}
        date={r.date}
        startTime={r.startTime}
        distanceM={r.distanceM}
        targetS={r.targetS}
        strategy={isStrategy(r.strategy) ? r.strategy : "even"}
        profile={r.profile}
      />
    </>
  );
}
