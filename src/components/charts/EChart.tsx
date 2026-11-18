"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, EffectScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, VisualMapPiecewiseComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { withIds } from "./theme";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  EffectScatterChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  VisualMapPiecewiseComponent,
  SVGRenderer,
]);

/** Sustituye recursivamente los valores "var(--x)" por su valor actual en el tema. */
function resolveVars<T>(v: T, css: CSSStyleDeclaration): T {
  if (typeof v === "string") {
    // alpha(var(--x), 0.3): el color del tema con transparencia (para degradados).
    const a = /^alpha\(var\((--[\w-]+)\),\s*([\d.]+)\)$/.exec(v);
    if (a) return withAlpha(css.getPropertyValue(a[1]).trim(), Number(a[2])) as T;
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

/** "#rrggbb" o "rgb(...)" con transparencia → "rgba(...)". */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((x) => x.trim());
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
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
  merge = true,
}: {
  option: EChartsCoreOption;
  /** Actualizar sin reiniciar el gráfico (sin repetir la animación de entrada). */
  merge?: boolean;
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
  const mergeRef = useRef(merge);
  useEffect(() => {
    selectRef.current = onSelect;
    itemRef.current = onItem;
  }, [onSelect, onItem]);

  const apply = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const opt = { ...resolveVars(optionRef.current, css) } as Record<string, unknown>;
    if (reduce) opt.animation = false;
    else if (opt.animation === undefined) opt.animation = true;
    // Primera vez: entera (con animación de entrada). Después, actualización con ids estables:
    // cambiar de filtro o tocar anima la transición sin repetir la entrada.
    if (mergeRef.current && chart.current?.getOption()) chart.current.setOption(withIds(opt), { replaceMerge: ["series", "visualMap", "xAxis", "yAxis"] });
    else chart.current?.setOption(withIds(opt), true);
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


export const axisLabel = { color: C.axis, fontFamily: C.font, fontSize: 11 };

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Etiquetas de un eje de tiempo en español: año el 1 de enero, mes el día 1, si no «d mes». */
export function timeLabel(v: number): string {
  const d = new Date(v);
  if (d.getDate() !== 1) return `${d.getDate()} ${MES[d.getMonth()]}`;
  return d.getMonth() === 0 ? String(d.getFullYear()) : MES[d.getMonth()];
}
