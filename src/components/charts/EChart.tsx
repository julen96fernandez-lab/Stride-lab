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

/** Sustituye recursivamente los valores "var(--x)" por su valor actual en el tema. */
function resolveVars<T>(v: T, css: CSSStyleDeclaration): T {
  if (typeof v === "string") {
    return (v.startsWith("var(--") ? css.getPropertyValue(v.slice(4, -1)).trim() || v : v) as T;
  }
  if (Array.isArray(v)) return v.map((x) => resolveVars(x, css)) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = resolveVars(x, css);
    return out as T;
  }
  return v;
}

/** Avisa cuando cambia el tema (selector de Perfil o el del sistema). */
export function onThemeChange(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  window.addEventListener("stride-theme", cb);
  mq.addEventListener("change", cb);
  return () => {
    window.removeEventListener("stride-theme", cb);
    mq.removeEventListener("change", cb);
  };
}

/**
 * Contenedor de ECharts: se redimensiona solo, se destruye al desmontar y vuelve a
 * pintar con los colores del tema (las opciones usan "var(--…)") cuando cambia.
 */
export function EChart({
  option,
  height,
  label,
  onSelect,
  onItem,
}: {
  option: EChartsCoreOption;
  height: number;
  /** Descripción accesible del gráfico. */
  label: string;
  /** Se llama con el índice de la categoría tocada (barras o eje). */
  onSelect?: (index: number) => void;
  /** Se llama al tocar un punto concreto (serie, índice). */
  onItem?: (seriesIndex: number, dataIndex: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);
  const selectRef = useRef(onSelect);
  const itemRef = useRef(onItem);
  useEffect(() => {
    selectRef.current = onSelect;
    itemRef.current = onItem;
  }, [onSelect, onItem]);

  const apply = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    chart.current?.setOption({ animation: !reduce, ...resolveVars(optionRef.current, css) }, true);
  };

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    const off = onThemeChange(() => requestAnimationFrame(apply));
    c.on("click", (e: { seriesIndex?: number; dataIndex?: number }) => {
      if (itemRef.current && e.seriesIndex !== undefined && e.dataIndex !== undefined) itemRef.current(e.seriesIndex, e.dataIndex);
    });
    // Toque en cualquier punto de la columna de una categoría (no solo sobre la barra).
    c.getZr().on("click", (e) => {
      if (!selectRef.current) return;
      const pt = [e.offsetX, e.offsetY];
      if (!c.containPixel("grid", pt)) return;
      const [idx] = c.convertFromPixel({ seriesIndex: 0 }, pt) as number[];
      if (Number.isFinite(idx)) selectRef.current(Math.round(idx));
    });
    return () => {
      off();
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    optionRef.current = option;
    apply();
  }, [option]);

  return <div ref={ref} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}

// ─── Estilo común ────────────────────────────────────────────────────────────

export const C = {
  lime: "var(--chart-line)",
  area: "var(--chart-area)",
  area0: "var(--chart-area-0)",
  bar: "var(--chart-bar)",
  barHover: "var(--fg-3)",
  grid: "var(--chart-grid)",
  axis: "var(--fg-2)",
  text: "var(--fg)",
  pointer: "var(--fg-3)",
  fg3: "var(--fg-3)",
  surface: "var(--card)",
  bg: "var(--bg)",
  font: "Inter, system-ui, sans-serif",
};

export const tooltipBase = {
  backgroundColor: "var(--card)",
  borderColor: "var(--line-strong)",
  borderWidth: 1,
  padding: [8, 12],
  extraCssText: "border-radius:14px;box-shadow:0 12px 30px -10px rgba(0,0,0,.45);",
  textStyle: { color: "var(--fg)", fontFamily: C.font, fontSize: 12 },
  confine: true,
};

export const axisLabel = { color: C.axis, fontFamily: C.font, fontSize: 11 };
