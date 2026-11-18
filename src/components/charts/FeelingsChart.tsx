"use client";

import { useMemo } from "react";
import { EChart } from "./EChart";
import { baseOption, categoryAxis, lineSeries, tipHead, tipRow, tooltip, valueAxis } from "./theme";
import { RATING_LABEL } from "@/lib/feelings/feelings";

const monthLabel = (m: string) => new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "short" }).format(new Date(`${m}-01T00:00:00Z`));

/** Valoración media por mes (1 fatal … 5 genial); los meses sin valoración quedan como hueco. */
export function FeelingsChart({ months }: { months: { month: string; avg: number | null; n: number }[] }) {
  const option = useMemo(
    () => ({
      ...baseOption({ left: 22, right: 10, top: 12, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const m = months[ps[0]?.dataIndex ?? 0];
          if (!m) return "";
          return (
            tipHead(new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${m.month}-01T00:00:00Z`))) +
            (m.avg === null ? tipRow("—", "Sin valoraciones") : tipRow(m.avg.toFixed(1).replace(".", ","), `media de ${m.n} · ${RATING_LABEL[Math.round(m.avg)]}`))
          );
        },
      }),
      xAxis: categoryAxis(months.map((m) => m.month), { every: 2, format: monthLabel }),
      yAxis: valueAxis({ min: 1, max: 5, interval: 1 }),
      series: [lineSeries({ data: months.map((m) => (m.avg === null ? null : Math.round(m.avg * 10) / 10)), points: true, smooth: false, name: "Valoración media" })],
    }),
    [months],
  );
  return <EChart option={option} height={170} label="Valoración media de tus sensaciones por mes" />;
}
