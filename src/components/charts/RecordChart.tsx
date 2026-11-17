"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RecordPoint } from "@/lib/analysis/best-efforts";
import { bandsToMs, type InjuryBand } from "@/lib/analysis/injuries";
import { injuryMarkArea } from "./injury";
import { C, EChart, axisLabel, tooltipBase } from "./EChart";
import { timeTicks } from "@/lib/analysis/time-ticks";

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
  points: RecordPoint[];
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
    let best = Infinity;
    const steps = points.map((p) => {
      best = Math.min(best, p.timeS);
      return [p.startAt.getTime(), best];
    });
    if (steps.length) steps.push([nowMs, best]);
    const first = points.length ? points[0].startAt.getTime() : nowMs - 365 * 86_400_000;
    const x0 = first - Math.max(7 * 86_400_000, (nowMs - first) * 0.03);
    const ticks = timeTicks(x0, nowMs);
    return {
      grid: { left: 46, right: 10, top: 16, bottom: 24 },
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (e: { seriesIndex: number; dataIndex: number }) => {
          if (e.seriesIndex !== 0) return "";
          const p = points[e.dataIndex];
          return `<div style="color:${C.axis};font-size:11px">${fmtDate(p.startAt)}${p.isRecord ? " · récord" : ""}</div><b>${clock(p.timeS)}</b> · ${clock(p.timeS / distanceKm)} /km`;
        },
      },
      xAxis: {
        type: "time",
        min: x0,
        max: nowMs,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        // Marcas regulares (mismo paso de calendario) con fechas en español.
        axisLabel: { ...axisLabel, customValues: ticks.values, formatter: ticks.label },
      },
      yAxis: {
        type: "value",
        inverse: true, // más arriba = más rápido
        min: Math.floor((Math.min(...t) * 0.97) / 10) * 10,
        max: Math.ceil((Math.max(...t) * 1.03) / 10) * 10,
        splitNumber: 3,
        axisLabel: { ...axisLabel, formatter: (v: number) => clock(v) },
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [
        {
          type: "scatter",
          data: points.map((p, i) => ({
            value: [p.startAt.getTime(), p.timeS],
            symbolSize: i === sel ? 13 : p.isRecord ? 10 : 6,
            itemStyle: {
              color: p.isRecord ? (p.startAt.getTime() >= yearAgo ? C.lime : C.text) : C.fg3,
              borderColor: i === sel ? C.text : C.surface,
              borderWidth: i === sel ? 2 : 1,
              opacity: p.isRecord ? 1 : 0.7,
            },
          })),
          markArea: points.length ? injuryMarkArea(bandsToMs(bands, points[0].startAt.getTime(), nowMs, nowMs), points[0].startAt.getTime(), nowMs) : undefined,
          z: 3,
        },
        {
          type: "line",
          step: "end",
          data: steps,
          showSymbol: false,
          silent: true,
          lineStyle: { color: C.lime, width: 2 },
          z: 2,
        },
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
        <Link href={`/actividad/${p.runId}`} className="mt-3 flex min-h-[56px] items-center gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2.5 active:opacity-70">
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
