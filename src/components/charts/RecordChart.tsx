"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RecordPoint } from "@/lib/analysis/best-efforts";
import { bandsToMs, type InjuryBand } from "@/lib/analysis/injuries";
import { injuryMarkArea } from "./injury";
import { C, EChart } from "./EChart";
import { T, baseOption, lineSeries, timeAxis, tipHead, tipRow, tooltip, valueAxis } from "./theme";
import { timeTicks } from "@/lib/analysis/time-ticks";
import { regularAxis, TIME_STEPS } from "@/lib/analysis/axis";

const clock = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(t % 60).padStart(2, "0")}`;
};
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", year: "numeric" }).format(d).replace(".", "");

/**
 * Evolución de un récord: cada punto es el mejor esfuerzo de una carrera; la escalera es el
 * récord vigente. Los récords de los últimos 12 meses van marcados en lima.
 */
export function RecordChart({
  points,
  bands,
  distanceKm,
  nowMs,
}: {
  points: (RecordPoint & { coarse?: boolean })[];
  bands: InjuryBand[];
  distanceKm: number;
  nowMs: number;
}) {
  const [sel, setSel] = useState<number>(() => {
    const last = points.map((p) => p.isRecord).lastIndexOf(true);
    return last;
  });
  const yearAgo = nowMs - 365 * 86_400_000;
  const option = useMemo(() => {
    const t = points.map((p) => p.timeS);
    // Récord vigente tras cada carrera (mínimo acumulado) y, al final, hasta hoy.
    const running = t.map((_, i) => Math.min(...t.slice(0, i + 1)));
    const steps = points.map((p, i) => [p.startAt.getTime(), running[i]]);
    if (steps.length) steps.push([nowMs, running[running.length - 1]]);
    const first = points.length ? points[0].startAt.getTime() : nowMs - 365 * 86_400_000;
    const x0 = first - Math.max(7 * 86_400_000, (nowMs - first) * 0.03);
    const ticks = timeTicks(x0, nowMs);
    const yAx = regularAxis(t, 4, TIME_STEPS);
    return {
      ...baseOption({ left: 46, right: 10, top: 16, bottom: 24 }),
      tooltip: tooltip({
        trigger: "item",
        pointer: false,
        formatter: (e: { seriesIndex: number; dataIndex: number }) => {
          if (e.seriesIndex !== 0) return "";
          const p = points[e.dataIndex];
          return tipHead(`${fmtDate(p.startAt)}${p.isRecord ? " · récord" : ""}`) + tipRow(`${p.coarse ? "≈" : ""}${clock(p.timeS)}`, `${clock(p.timeS / distanceKm)} /km`);
        },
      }),
      // Marcas regulares (mismo paso de calendario) con fechas en español.
      xAxis: timeAxis({ min: x0, max: nowMs, ticks: ticks.values, format: ticks.label }),
      // Más arriba = más rápido.
      yAxis: valueAxis({ min: yAx.min, max: yAx.max, interval: yAx.interval, inverse: true, format: (v) => clock(v) }),
      series: [
        {
          type: "scatter",
          data: points.map((p, i) => ({
            value: [p.startAt.getTime(), p.timeS],
            symbolSize: i === sel ? 13 : p.isRecord ? 10 : 6,
            itemStyle: {
              color: p.isRecord ? (p.startAt.getTime() >= yearAgo ? C.lime : C.text) : C.fg3,
              borderColor: i === sel ? T.text : T.surface,
              borderWidth: i === sel ? 2 : 1,
              opacity: p.isRecord ? 1 : 0.7,
              shadowBlur: i === sel ? 12 : 0,
              shadowColor: p.isRecord ? C.lime : C.fg3,
            },
          })),
          markArea: points.length ? injuryMarkArea(bandsToMs(bands, points[0].startAt.getTime(), nowMs, nowMs), points[0].startAt.getTime(), nowMs) : undefined,
          z: 3,
        },
        // Escalera del récord vigente, con degradado que se desvanece.
        { ...lineSeries({ data: steps, step: "end", area: true, areaOrigin: "end", z: 2 }), silent: true },
      ],
    };
  }, [points, bands, sel, yearAgo, distanceKm, nowMs]);

  const p = sel >= 0 ? points[sel] : null;
  return (
    <div>
      <EChart option={option} height={220} label="Evolución del récord" onItem={(si, di) => si === 0 && setSel(di)} />
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-fg-2" aria-label="Leyenda">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--chart-line)" }} /> Récord en los últimos 12 meses
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--fg)" }} /> Récord anterior
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--fg-3)" }} /> Otras carreras
        </li>
      </ul>
      {p && (
        <Link href={`/actividad/${p.runId}`} className="mt-3 flex min-h-[56px] items-center gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-fg-2">
              {fmtDate(p.startAt)}
              {p.isRecord ? " · récord en esa fecha" : ""}
            </div>
            <div className="mt-0.5 text-[14px]">
              <b className="num text-[18px]">{clock(p.timeS)}</b> · {clock(p.timeS / distanceKm)} /km
            </div>
          </div>
          <span className="text-[13px] font-semibold text-fg-2">Ver carrera</span>
        </Link>
      )}
    </div>
  );
}
