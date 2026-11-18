"use client";

import { ConsistencyCalendar } from "./InsightCharts";
import { useChoice } from "@/components/ui/Choice";
import type { CalendarDay } from "@/lib/analysis/insights";
import type { InjuryBand } from "@/lib/analysis/injuries";

/** Calendario de constancia por km o por carga, según el selector (los días llegan una sola vez). */
export function CalendarChoice({ days, bands }: { days: CalendarDay[]; bands: InjuryBand[] }) {
  const [cal] = useChoice("cal");
  const metric = cal === "carga" ? "load" : "km";
  return (
    <>
      <div className="mt-4">
        <ConsistencyCalendar key={metric} days={days} metric={metric} bands={bands} />
      </div>
      {metric === "load" && <p className="mt-2 text-[12px] text-fg-2">Los días con carrera pero sin pulso no tienen carga y salen en gris.</p>}
    </>
  );
}
