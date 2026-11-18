import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { RaceForm } from "@/components/race/RaceForm";
import { RaceCountdown } from "@/components/race/RaceCards";
import { planScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { fmtTime } from "@/lib/race/race";
import { PacingCard } from "@/components/race/PacingCard";
import { PostRaceCard } from "@/components/race/PostRaceCard";
import { isStrategy } from "@/lib/race/pacing";

export const metadata = { title: "Carrera objetivo · Stride Lab" };

export default function RacePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/plan" className="mt-4 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-fg-2">
        ‹ Plan
      </Link>
      <Suspense fallback={<ProfileSkeleton rows={6} />}>
        <RaceData params={params} />
      </Suspense>
    </div>
  );
}

async function RaceData({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { races, predictions } = await planScreen(cacheDay());
  const race = races.find((r) => r.id === id);
  if (!race) notFound();
  const p = race.profile;
  const diff = p ? p.gpxM - race.distanceM : 0;
  const profileNote = p
    ? `Recorrido cargado: el GPX mide ${(p.gpxM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} km${Math.abs(diff) >= 50 ? ` (${diff > 0 ? "+" : "−"}${Math.round(Math.abs(diff))} m respecto a la distancia oficial; se usa solo el perfil, ajustado a la oficial)` : ""}. Desnivel positivo ≈${p.gainM} m.`
    : null;
  return (
    <>
      <RaceCountdown race={race} />
      {race.prediction && (
        <p className="px-1 text-[13px] text-fg-2">
          Predicción de Plan para esta distancia: ≈{fmtTime(race.prediction.timeS)} (entre {fmtTime(race.prediction.lowS)} y {fmtTime(race.prediction.highS)}, confianza{" "}
          {race.prediction.confidence}).
        </p>
      )}
      {profileNote && (
        <p className="rounded-2xl border border-line bg-inset px-3.5 py-3 text-[13px] leading-snug">{profileNote}</p>
      )}
      {race.days <= 0 && (
        <PostRaceCard
          raceId={race.id}
          date={race.date}
          distanceM={race.distanceM}
          targetS={race.targetS}
          strategy={isStrategy(race.strategy) ? race.strategy : "even"}
          profile={race.profile}
          actual={race.actual}
          candidates={race.candidates}
        />
      )}
      <PacingCard
        raceId={race.id}
        distanceM={race.distanceM}
        targetS={race.targetS}
        startTime={race.startTime}
        profile={race.profile}
        initial={isStrategy(race.strategy) ? race.strategy : "even"}
      />
      <div className="eyebrow mt-2 px-1">Editar</div>
      <RaceForm
        initial={{
          id: race.id,
          name: race.name,
          date: race.date,
          distanceKey: race.distanceKey,
          distanceKm: race.distanceKey === "other" ? String(race.distanceM / 1000).replace(".", ",") : "",
          startTime: race.startTime ?? "",
          target: fmtTime(race.targetS),
          hasProfile: !!p,
          profileNote,
        }}
        preds={predictions.now}
        sources={predictions.sources}
        longestM={predictions.longestM}
      />
    </>
  );
}
