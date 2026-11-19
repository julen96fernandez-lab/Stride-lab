"use client";

import Link from "next/link";
import { useMemo } from "react";
import { EChart } from "@/components/charts/EChart";
import { T, baseOption, categoryAxis, lineSeries, tipHead, tipRow, tooltip, valueAxis } from "@/components/charts/theme";
import { DASH, date, duration, int, pace } from "@/lib/format";

export interface SameRouteItem {
  id: string;
  startAt: string | Date;
  durationS: number;
  paceS: number | null;
  avgHr: number | null;
  temperatureC: number | null;
  current: boolean;
}

const HR_COLOR = "var(--z4)";
const short = (d: Date) => date(d, { day: "numeric", month: "short", year: "2-digit" });
/** «17/10/26»: cabe en la tabla en un iPhone estrecho */
const numeric = (d: Date) => date(d, { day: "2-digit", month: "2-digit", year: "2-digit" });

/** Carreras por el mismo recorrido: lista y ritmo/pulso por fecha, con la actual marcada. */
export function SameRouteCard({ rows }: { rows: SameRouteItem[] }) {
  const asc = useMemo(() => [...rows].map((r) => ({ ...r, at: new Date(r.startAt) })).sort((a, b) => a.at.getTime() - b.at.getTime()), [rows]);
  const option = useMemo(() => {
    const hasHr = asc.filter((r) => r.avgHr !== null).length >= 2;
    const paces = asc.map((r) => (r.paceS === null ? null : r.current ? { value: r.paceS, symbolSize: 12, itemStyle: { color: T.accent, borderColor: T.surface, borderWidth: 2 } } : r.paceS));
    const hrs = asc.map((r) => (r.avgHr === null ? null : r.current ? { value: r.avgHr, symbolSize: 11, itemStyle: { color: HR_COLOR, borderColor: T.surface, borderWidth: 2 } } : r.avgHr));
    const pv = asc.flatMap((r) => (r.paceS === null ? [] : [r.paceS]));
    // Eje de ritmo en pasos redondos (múltiplos de 15 s), 3 tramos.
    const step = Math.max(15, Math.ceil((Math.max(...pv) - Math.min(...pv) + 10) / 3 / 15) * 15);
    const lo = Math.floor((Math.min(...pv) - 5) / step) * step;
    const hi = lo + step * 3;
    return {
      ...baseOption({ left: 40, right: hasHr ? 34 : 10, top: 14, bottom: 24 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const r = asc[ps[0]?.dataIndex ?? 0];
          if (!r) return "";
          return (
            tipHead(`${short(r.at)}${r.current ? " · esta" : ""}`) +
            tipRow(r.paceS === null ? DASH : `${pace(r.paceS)} /km`, "Ritmo") +
            (r.avgHr !== null ? tipRow(`${int(r.avgHr)} ppm`, "Pulso medio", HR_COLOR) : "") +
            (r.temperatureC !== null ? tipRow(`${Math.round(r.temperatureC)} °C`, "Temperatura") : "")
          );
        },
      }),
      xAxis: categoryAxis(asc.map((r) => short(r.at)), { every: Math.max(1, Math.round(asc.length / 5)) }),
      yAxis: [
        valueAxis({ min: lo, max: hi, interval: step, inverse: true, format: (v: number) => pace(v) }),
        ...(hasHr ? [{ ...valueAxis({ format: (v: number) => `${Math.round(v)}`, splitNumber: 3 }), scale: true, splitLine: { show: false } }] : []),
      ],
      series: [
        { ...lineSeries({ data: paces, points: true, smooth: false, name: "Ritmo" }), connectNulls: true, z: 3 },
        ...(hasHr ? [{ ...lineSeries({ data: hrs, points: true, smooth: false, name: "Pulso", color: HR_COLOR, dashed: true }), yAxisIndex: 1, connectNulls: true, z: 2 }] : []),
      ],
    };
  }, [asc]);

  return (
    <section className="card p-5" aria-label="Misma ruta">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">Misma ruta</div>
        <span className="text-[12px] text-fg-2">{rows.length} veces por este recorrido</span>
      </div>
      <div className="mt-3">
        <EChart option={option} height={170} label="Ritmo y pulso medio por fecha en este recorrido" />
      </div>
      <p className="mt-1 text-[11px] text-fg-2">
        Línea continua: ritmo (más arriba, más rápido). Discontinua: pulso medio (eje derecho). El punto grande (y el punto lima de la tabla) es esta carrera.
      </p>
      <table className="mt-3 w-full text-[12px] min-[360px]:text-[13px]">
        <thead>
          <tr className="text-[11px] tracking-[0.06em] text-fg-2 uppercase">
            <th scope="col" className="py-1.5 text-left font-semibold">Fecha</th>
            <th scope="col" className="py-1.5 pl-1.5 min-[360px]:pl-2.5 text-right font-semibold">Tiempo</th>
            <th scope="col" className="py-1.5 pl-1.5 min-[360px]:pl-2.5 text-right font-semibold">Ritmo</th>
            <th scope="col" className="py-1.5 pl-1.5 min-[360px]:pl-2.5 text-right font-semibold">Pulso</th>
            <th scope="col" className="py-1.5 pl-1.5 min-[360px]:pl-2.5 text-right font-semibold">°C</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const at = new Date(r.startAt);
            const cells = (
              <>
                <td className="py-0">
                  {r.current ? (
                    <span className="flex min-h-[44px] items-center gap-1.5 font-semibold whitespace-nowrap">
                      <span className="h-2 w-2 flex-none rounded-full bg-lime" aria-hidden="true" />
                      {numeric(at)}
                      <span className="sr-only">(esta carrera)</span>
                    </span>
                  ) : (
                    <Link href={`/actividad/${r.id}`} className="flex min-h-[44px] items-center whitespace-nowrap underline-offset-2 hover:underline">
                      {numeric(at)}
                    </Link>
                  )}
                </td>
                <td className="num pl-1.5 min-[360px]:pl-2.5 text-right">{duration(r.durationS)}</td>
                <td className="num pl-1.5 min-[360px]:pl-2.5 text-right">{r.paceS === null ? DASH : pace(r.paceS)}</td>
                <td className="num pl-1.5 min-[360px]:pl-2.5 text-right">{r.avgHr === null ? DASH : int(r.avgHr)}</td>
                <td className="num pl-1.5 min-[360px]:pl-2.5 text-right text-fg-2">{r.temperatureC === null ? DASH : Math.round(r.temperatureC)}</td>
              </>
            );
            return (
              <tr key={r.id} className={r.current ? "font-semibold" : ""}>
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 rounded-xl border border-line-strong bg-inset px-3 py-2 text-[12px] leading-snug">
        Mismo recorrido, distinto día: la temperatura, la humedad y lo descansado que estuvieras cambian entre fechas. Compáralo con eso en mente.
      </p>
    </section>
  );
}
