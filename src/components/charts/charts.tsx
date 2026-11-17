"use client";

import { useMemo } from "react";
import { C, EChart, axisLabel, tooltipBase } from "./EChart";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const dec1 = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const paceStr = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

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
    const last = data[data.length - 1];
    const values = points.map((p) => p.value);
    const min = Math.floor(Math.min(...values) - 1);
    const max = Math.ceil(Math.max(...values) + 1);
    return {
      grid: { left: zoom ? 34 : 4, right: 12, top: 14, bottom: zoom ? 28 : 6 },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: "rgba(244,245,238,0.35)", width: 1 } },
        formatter: (ps: { value: [string, number] }[]) =>
          `<div style="color:${C.axis};font-size:11px">${fmtDay(ps[0].value[0])}</div><div style="font-family:'Space Grotesk';font-weight:700;font-size:18px">${dec1(ps[0].value[1])}</div>`,
      },
      xAxis: {
        type: "time",
        show: zoom,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisLabel, hideOverlap: true, formatter: { year: "{yyyy}", month: "{MMM}", day: "" } },
      },
      yAxis: {
        type: "value",
        min,
        max,
        show: zoom,
        splitNumber: 3,
        axisLabel,
        splitLine: { lineStyle: { color: C.grid } },
      },
      dataZoom: zoom ? [{ type: "inside", start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true }] : [],
      series: [
        {
          type: "line",
          data,
          smooth: 0.35,
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2.5, color: C.lime, cap: "round", join: "round" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(200,242,58,0.32)" },
                { offset: 1, color: "rgba(200,242,58,0)" },
              ],
            },
          },
          emphasis: { focus: "none", itemStyle: { color: C.lime, borderColor: "#0A0B09", borderWidth: 2 } },
        },
        last && {
          type: "effectScatter",
          data: [last],
          symbolSize: 9,
          itemStyle: { color: C.lime, shadowBlur: 12, shadowColor: C.lime },
          rippleEffect: { scale: 3.2, brushType: "fill", period: 3 },
          tooltip: { show: false },
          z: 5,
        },
      ].filter(Boolean),
    };
  }, [points, zoom]);
  if (points.length < 2) return null;
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
      grid: { left: 2, right: 2, top: 10, bottom: 22 },
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: { dataIndex: number }) => {
          const b = bars[p.dataIndex];
          return `<div style="color:${C.axis};font-size:11px">${b.tooltip}</div><div style="font-family:'Space Grotesk';font-weight:700;font-size:18px">${b.value ? `${Math.round(b.value).toLocaleString("es-ES")} ${unit}` : "Sin carreras"}</div>`;
        },
      },
      xAxis: {
        type: "category",
        data: bars.map((b) => b.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, interval: 0 },
      },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "bar",
          barCategoryGap: "28%",
          data: bars.map((b, i) => ({
            value: b.value,
            itemStyle: {
              color: i === highlight ? C.lime : C.bar,
              borderRadius: [6, 6, 3, 3],
              shadowBlur: i === highlight ? 16 : 0,
              shadowColor: i === highlight ? "rgba(200,242,58,0.45)" : "transparent",
            },
          })),
          emphasis: { itemStyle: { color: C.barHover } },
        },
      ],
    }),
    [bars, highlight, unit],
  );
  return <EChart option={option} height={height} label={label} />;
}

/** Serie a lo largo de la carrera (FC o potencia) frente al tiempo. */
export function RunLineChart({
  t,
  v,
  unit,
  height = 130,
  label,
}: {
  t: number[];
  v: number[];
  unit: string;
  height?: number;
  label: string;
}) {
  const option = useMemo(() => {
    // Reduce a ~400 puntos para que el gráfico sea fluido.
    const step = Math.max(1, Math.floor(t.length / 400));
    const data: [number, number][] = [];
    for (let i = 0; i < t.length; i += step) data.push([t[i] / 60, v[i]]);
    const vals = data.map((d) => d[1]);
    return {
      grid: { left: 34, right: 10, top: 10, bottom: 24 },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: "rgba(244,245,238,0.35)", width: 1 } },
        formatter: (ps: { value: [number, number] }[]) => {
          const [m, val] = ps[0].value;
          const mm = Math.floor(m);
          const ss = Math.round((m - mm) * 60);
          return `<div style="color:${C.axis};font-size:11px">min ${mm}:${String(ss).padStart(2, "0")}</div><div style="font-family:'Space Grotesk';font-weight:700;font-size:18px">${Math.round(val)} ${unit}</div>`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: Math.ceil(data[data.length - 1]?.[0] ?? 1),
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisLabel, formatter: (x: number) => `${Math.round(x)}′` },
      },
      yAxis: {
        type: "value",
        min: Math.floor(Math.min(...vals) / 10) * 10,
        max: Math.ceil(Math.max(...vals) / 10) * 10,
        splitNumber: 3,
        axisLabel,
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [
        {
          type: "line",
          data,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { width: 2, color: C.lime },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(200,242,58,0.22)" },
                { offset: 1, color: "rgba(200,242,58,0)" },
              ],
            },
          },
        },
      ],
    };
  }, [t, v, unit]);
  if (t.length < 2) return null;
  return <EChart option={option} height={height} label={label} />;
}

export { paceStr };

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
  const option = useMemo(
    () => ({
      grid: { left: 2, right: 2, top: 10, bottom: 22 },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } },
        formatter: (ps: { dataIndex: number }[]) => {
          const y = years[ps[0].dataIndex];
          const tot = types.reduce((a, t) => a + (y.km[t.key] ?? 0), 0);
          if (tot <= 0) return `<div style="color:${C.axis};font-size:11px">${y.year}</div><div>Sin carreras</div>`;
          const rows = types
            .filter((t) => (y.km[t.key] ?? 0) > 0)
            .sort((a, b) => (y.km[b.key] ?? 0) - (y.km[a.key] ?? 0))
            .map(
              (t) =>
                `<div style="display:flex;gap:10px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${t.color};margin-right:6px"></span>${t.label}</span><b>${Math.round(y.km[t.key])} km</b></div>`,
            )
            .join("");
          return `<div style="color:${C.axis};font-size:11px;margin-bottom:4px">${y.year} · ${Math.round(tot)} km</div>${rows}`;
        },
      },
      xAxis: {
        type: "category",
        data: years.map((y) => String(y.year).slice(2)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, interval: 0 },
      },
      yAxis: { type: "value", show: false },
      series: types.map((t, i) => ({
        name: t.label,
        type: "bar",
        stack: "km",
        barCategoryGap: "28%",
        data: years.map((y) => (y.km[t.key] ? Math.round(y.km[t.key] * 10) / 10 : 0)),
        itemStyle: { color: t.color, borderColor: "#151712", borderWidth: 1, borderRadius: i === types.length - 1 ? [5, 5, 0, 0] : 0 },
        emphasis: { focus: "series" },
      })),
    }),
    [years, types],
  );
  return <EChart option={option} height={height} label={label} />;
}
