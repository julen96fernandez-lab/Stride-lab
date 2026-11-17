"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, EffectScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  EffectScatterChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  SVGRenderer,
]);

/** Contenedor de ECharts: se redimensiona solo y se destruye al desmontar. */
export function EChart({
  option,
  height,
  label,
}: {
  option: EChartsCoreOption;
  height: number;
  /** Descripción accesible del gráfico. */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.current?.setOption({ animation: !reduce, ...option }, true);
  }, [option]);

  return <div ref={ref} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}

// ─── Estilo común ────────────────────────────────────────────────────────────

export const C = {
  lime: "#C8F23A",
  limeSoft: "rgba(200,242,58,0.35)",
  bar: "#34372F",
  barHover: "#4A4E43",
  grid: "rgba(255,255,255,0.06)",
  axis: "#A9ACA2",
  text: "#F4F5EE",
  font: "Inter, system-ui, sans-serif",
};

export const tooltipBase = {
  backgroundColor: "rgba(21,23,18,0.92)",
  borderColor: "rgba(255,255,255,0.12)",
  borderWidth: 1,
  padding: [8, 12],
  extraCssText: "border-radius:14px;backdrop-filter:blur(12px);box-shadow:0 12px 30px -10px rgba(0,0,0,.8);",
  textStyle: { color: C.text, fontFamily: C.font, fontSize: 12 },
  confine: true,
};

export const axisLabel = { color: C.axis, fontFamily: C.font, fontSize: 11 };
