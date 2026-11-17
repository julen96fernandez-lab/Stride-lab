import Link from "next/link";
import { RouteThumb } from "@/components/map/RouteMap";
import type { RunListItem } from "@/lib/db/queries";
import { TypeTag } from "./SessionType";
import { LoadBadge } from "./Load";
import { DASH, cap, date, duration, int, km, pace } from "@/lib/format";

/** Fila de carrera para listas (Actividad e Inicio). */
export function RunRow({ run }: { run: RunListItem }) {
  return (
    <Link href={`/actividad/${run.id}`} className="flex min-h-[76px] items-center gap-3.5 py-2.5 active:opacity-70">
      <RouteThumb shape={run.route} size={58} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px] text-fg-2">
          <span>{cap(date(run.startAt, { weekday: "short", day: "numeric", month: "short" }))}</span>
          {run.isSpecial && <Tag>Especial</Tag>}
          {run.source === "strava" && <Tag>Strava</Tag>}
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="num text-[24px]">{km(run.distanceM)}</span>
          <span className="text-[12px] text-fg-2">km</span>
        </div>
        {(run.type || run.trainingLoad !== null) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {run.type && <TypeTag type={run.type} manual={run.typeManual} />}
            <LoadBadge load={run.trainingLoad} />
          </div>
        )}
      </div>
      <div className="flex-none text-right text-[13px] leading-[1.5]">
        <div>
          <span className="font-semibold">{pace(run.avgPaceSPerKm)}</span>
          <span className="text-fg-2"> /km</span>
        </div>
        <div className="text-fg-2">{duration(run.durationS)}</div>
        <div className="text-fg-2">{run.avgHr === null ? DASH : `${int(run.avgHr)} ppm`}</div>
      </div>
    </Link>
  );
}

export function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "lime" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] uppercase ${
        tone === "lime" ? "bg-lime text-lime-ink" : "border border-line-strong text-fg-2"
      }`}
    >
      {children}
    </span>
  );
}
