"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { T, baseOption, barItem, barSeries, categoryAxis, refLine, tipHead, tipRow, tooltip, valueAxis } from "@/components/charts/theme";
import { Segmented } from "@/components/ui/Segmented";
import type { MetricCompare, SimilarMetric } from "@/lib/analysis/similar";
import { date, int, pace } from "@/lib/format";

const META: Record<SimilarMetric, { label: string; fmt: (v: number) => string; unit: string }> = {
  pace: { label: "Ritmo", fmt: pace, unit: "/km" },
  hr: { label: "Pulso", fmt: (v) => int(v), unit: "ppm" },
  load: { label: "Carga", fmt: (v) => String(Math.round(v)), unit: "" },
};
const short = (d: Date | string) => date(new Date(d), { day: "numeric", month: "short" });

/** La carrera frente a sus 5 últimas parecidas: barras por fecha, media y posición de la actual. */
export function SimilarCard({ metrics, typeLabel }: { metrics: MetricCompare[]; typeLabel: string }) {
  const [key, setKey] = useState<SimilarMetric>(metrics[0].key);
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  const meta = META[m.key];
  const option = useMemo(() => {
    const vals = m.bars.map((b) => b.value);
    // Ritmo: barras desde un suelo cercano para que las diferencias se vean (más baja = más rápida).
    const lo = m.key === "pace" ? Math.floor((Math.min(...vals) - 20) / 10) * 10 : 0;
    return {
      ...baseOption({ left: 40, right: 10, top: 14, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const b = m.bars[ps[0]?.dataIndex ?? 0];
          if (!b) return "";
          return tipHead(`${short(b.startAt)}${b.current ? " · esta" : ""}`) + tipRow(`${meta.fmt(b.value)} ${meta.unit}`.trim(), meta.label);
        },
      }),
      xAxis: categoryAxis(m.bars.map((b) => (b.current ? "Esta" : short(b.startAt)))),
      yAxis: valueAxis({ min: lo, format: (v: number) => meta.fmt(v), splitNumber: 3 }),
      series: [
        {
          ...barSeries({
            data: m.bars.map((b) => ({ value: b.value, itemStyle: barItem({ color: b.current ? T.accent : T.muted, current: b.current }) })),
            maxWidth: 28,
          }),
          markLine: refLine({ value: m.mean, label: "media" }),
        },
      ],
    };
  }, [m, meta]);

  return (
    <section className="card p-5" aria-label="Sesiones parecidas">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">Sesiones parecidas</div>
        <span className="text-[12px] text-fg-2">{m.of - 1} anteriores</span>
      </div>
      <p className="mt-1 text-[12px] text-fg-2">Frente a tus {typeLabel} anteriores de distancia parecida (±20 %), de los últimos 12 meses.</p>
      {metrics.length > 1 && (
        <div className="mt-3">
          <Segmented label="Métrica" value={key} onChange={(k) => setKey(k as SimilarMetric)} items={metrics.map((x) => ({ key: x.key, label: META[x.key].label }))} stretch />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-[15px] font-semibold">{m.position}</span>
        <span className="text-[12px] whitespace-nowrap text-fg-2">
          media {meta.fmt(m.mean)} {meta.unit}
        </span>
      </div>
      <div className="mt-2">
        <EChart option={option} height={150} label={`${meta.label} de esta carrera frente a sus parecidas`} />
      </div>
      <p className="mt-1 text-[11px] text-fg-2">
        En color: esta carrera. Línea: media de las anteriores.{m.key === "pace" ? " Barra más baja, ritmo más rápido." : ""}
        {m.key === "hr" ? " Solo carreras con pulso fiable." : ""}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0 text-[12px]">
        {m.bars
          .filter((b) => !b.current)
          .map((b) => (
            <li key={b.id}>
              <Link href={`/actividad/${b.id}`} className="inline-flex min-h-[44px] items-center text-fg-2 underline-offset-2 hover:underline">
                {short(b.startAt)} ›
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}
