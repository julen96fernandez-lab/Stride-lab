"use client";

import { useMemo } from "react";
import { PaceTrend } from "./InsightCharts";
import { ChoiceSelector, useChoice } from "@/components/ui/Choice";
import { SessionIcon } from "@/components/ui/SessionType";
import { RANGE_DAYS, smoothTrend, type PacePoint, type PaceRange } from "@/lib/analysis/insights";
import { TYPE_META } from "@/lib/analysis/session-type";
import { PACE_RANGES, PACE_TYPES } from "@/lib/analysis/pace-options";

/**
 * Evolución del ritmo: llegan todos los puntos y el rango y el tipo se filtran aquí (al
 * instante); la tendencia se recalcula con los mismos puntos, sin las carreras en lesión.
 */
export function PaceEvolution({ points, bands, nowMs }: { points: PacePoint[]; bands: { startDate: string; endDate: string | null }[]; nowMs: number }) {
  const [range] = useChoice("rango");
  const [rtipo] = useChoice("rtipo");
  const type = rtipo === "todos" ? null : rtipo;
  const shown = useMemo(() => {
    const days = RANGE_DAYS[range as PaceRange] ?? null;
    const from = days === null ? -Infinity : nowMs - days * 86_400_000;
    return points.filter((p) => p.t >= from && p.t <= nowMs && (!type || p.type === type));
  }, [points, range, type, nowMs]);
  const trend = useMemo(() => smoothTrend(shown.filter((p) => !p.inInjury)), [shown]);
  return (
    <>
      <div className="mt-3">
        <ChoiceSelector name="rango" variant="chips" label="Rango" items={PACE_RANGES.map(([r, label]) => ({ key: r, label }))} />
      </div>
      <div className="mt-2">
        <ChoiceSelector
          name="rtipo"
          variant="chips"
          label="Tipo de sesión"
          items={PACE_TYPES.map((t) => ({
            key: t ?? "todos",
            label: (
              <>
                {t && (
                  <span className="flex" style={{ color: t === type ? undefined : TYPE_META[t].color }}>
                    <SessionIcon type={t} size={13} />
                  </span>
                )}
                {t ? TYPE_META[t].label : "Todos"}
              </>
            ),
          }))}
        />
      </div>
      <div className="mt-3">
        <PaceTrend points={shown} trend={trend} bands={bands} nowMs={nowMs} />
      </div>
      <p className="mt-2 text-[12px] text-fg-2">
        {shown.length} {shown.length === 1 ? "carrera" : "carreras"}. Sin sesiones especiales (más de 8:00 /km).
      </p>
    </>
  );
}
