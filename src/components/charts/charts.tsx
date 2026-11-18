"use client";

import { useMemo } from "react";
import { EChart, timeLabel } from "./EChart";
import { ChartEmpty } from "./ChartEmpty";
import { T, baseOption, barItem, barSeries, categoryAxis, lineSeries, tipHead, tipRow, tooltip, valueAxis } from "./theme";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const dec1 = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Tendencia (VO₂ máx.): línea gruesa con relleno degradado, punto final con halo,
 * tooltip al deslizar el dedo. `zoom` añade zoom/arrastre táctil (historial largo).
 */
export function TrendChart({
  points,
  height = 150,
  zoom = false,
  label,
}: {
  points: { day: string; value: number }[];
  height?: number;
  zoom?: boolean;
  label: string;
}) {
  const option = useMemo(() => {
    const data = points.map((p) => [p.day, p.value]);
    const values = points.map((p) => p.value);
    const min = Math.floor(Math.min(...values) - 1);
    const max = Math.ceil(Math.max(...values) + 1);
    const last = data[data.length - 1];
    return {
      ...baseOption({ left: zoom ? 34 : 4, right: 12, top: 14, bottom: zoom ? 26 : 6 }),
      tooltip: tooltip({ formatter: (ps: { value: [string, number] }[]) => tipHead(fmtDay(ps[0].value[0])) + tipRow(dec1(ps[0].value[1])) }),
      xAxis: {
        type: "time",
        show: zoom,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...valueAxis().axisLabel, formatter: timeLabel },
      },
      yAxis: valueAxis({ min, max, show: zoom }),
      dataZoom: zoom ? [{ type: "inside", start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true }] : [],
      series: [
        lineSeries({ data, area: true }),
        // Último dato real: punto con brillo.
        { ...lineSeries({ data: last ? [last] : [], points: true }), symbolSize: 8, itemStyle: { color: T.accent, borderColor: T.surface, borderWidth: 2, shadowBlur: 12, shadowColor: "alpha(var(--chart-line),0.6)" }, tooltip: { show: false }, z: 5 },
      ],
    };
  }, [points, zoom]);
  if (points.length < 2) return <ChartEmpty message="Aún no hay lecturas suficientes de VO₂ máx. para dibujar la tendencia." height={height} />;
  return <EChart option={option} height={height} label={label} />;
}

/**
 * Barras (km por mes / por año). La barra resaltada va en lima; el resto, neutras.
 * Las categorías con valor 0 se muestran como hueco (no se rellenan).
 */
export function BarsChart({
  bars,
  highlight,
  height = 140,
  unit = "km",
  label,
}: {
  bars: { key: string; label: string; value: number; tooltip: string }[];
  highlight: number;
  height?: number;
  unit?: string;
  label: string;
}) {
  const option = useMemo(
    () => ({
      ...baseOption({ left: 2, right: 2, top: 10, bottom: 22 }),
      tooltip: tooltip({
        trigger: "item",
        pointer: false,
        formatter: (p: { dataIndex: number }) => {
          const b = bars[p.dataIndex];
          return tipHead(b.tooltip) + tipRow(b.value ? `${Math.round(b.value).toLocaleString("es-ES")} ${unit}` : "Sin carreras");
        },
      }),
      xAxis: categoryAxis(bars.map((b) => b.label)),
      yAxis: valueAxis({ show: false }),
      series: [barSeries({ data: bars.map((b, i) => ({ value: b.value, itemStyle: barItem({ current: i === highlight }) })) })],
    }),
    [bars, highlight, unit],
  );
  if (!bars.some((b) => b.value > 0)) return <ChartEmpty message="Sin carreras en este periodo." height={height} kind="bars" />;
  return <EChart option={option} height={height} label={label} />;
}

/**
 * Km por año apilados por tipo de sesión. Orden de tipos fijo (paleta validada),
 * 2 px de separación entre segmentos, leyenda siempre visible y tooltip por año.
 */
export function StackedTypeYears({
  years,
  types,
  height = 220,
  label,
}: {
  years: { year: number; km: Record<string, number> }[];
  types: { key: string; label: string; color: string }[];
  height?: number;
  label: string;
}) {
  const option = useMemo(() => {
    // Esquinas redondeadas solo en el segmento de arriba de cada columna.
    const topIdx = years.map((y) => {
      let top = -1;
      types.forEach((t, i) => {
        if ((y.km[t.key] ?? 0) > 0) top = i;
      });
      return top;
    });
    return {
      ...baseOption({ left: 2, right: 2, top: 10, bottom: 22 }),
      tooltip: tooltip({
        pointer: false,
        formatter: (ps: { dataIndex: number }[]) => {
          const y = years[ps[0].dataIndex];
          const tot = types.reduce((a, t) => a + (y.km[t.key] ?? 0), 0);
          if (tot <= 0) return tipHead(String(y.year)) + tipRow("Sin carreras");
          return (
            tipHead(`${y.year} · ${Math.round(tot)} km`) +
            types
              .filter((t) => (y.km[t.key] ?? 0) > 0)
              .sort((a, b) => (y.km[b.key] ?? 0) - (y.km[a.key] ?? 0))
              .map((t) => tipRow(`${Math.round(y.km[t.key])} km`, t.label, t.color))
              .join("")
          );
        },
      }),
      xAxis: categoryAxis(years.map((y) => `'${String(y.year).slice(2)}`)),
      yAxis: valueAxis({ show: false }),
      series: types.map((t, i) =>
        barSeries({
          name: t.label,
          stack: "km",
          data: years.map((y, yi) => ({
            value: y.km[t.key] ? Math.round(y.km[t.key] * 10) / 10 : 0,
            itemStyle: { ...barItem({ color: t.color, top: topIdx[yi] === i }), borderColor: "var(--card)", borderWidth: 1 },
          })),
        }),
      ),
    };
  }, [years, types]);
  return <EChart option={option} height={height} label={label} />;
}
