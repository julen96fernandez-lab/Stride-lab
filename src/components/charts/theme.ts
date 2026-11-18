/**
 * Estilo común de todos los gráficos (la referencia es el detalle de carrera): colores del tema,
 * grosores, rejilla, ejes, tipografía, tooltip y animación. Cambiar aquí cambia toda la app.
 *
 * Los colores son "var(--x)" (o "alpha(var(--x),0.3)"); EChart.tsx los resuelve con el tema
 * actual, así que día y noche comparten estas mismas piezas.
 */

export const FONT = "Inter, system-ui, sans-serif";

export const T = {
  accent: "var(--chart-line)",
  text: "var(--fg)",
  muted: "var(--fg-2)",
  faint: "var(--fg-3)",
  bar: "var(--chart-bar)",
  surface: "var(--card)",
  /** rejilla muy tenue */
  grid: "alpha(var(--fg),0.07)",
  /** líneas de referencia (objetivo, media) */
  ref: "alpha(var(--fg),0.5)",
} as const;

export const LINE_WIDTH = 2;
export const SMOOTH = 0.35;
export const LABEL_SIZE = 10;

/** Color del tema con transparencia (lo resuelve EChart.tsx). */
export function alpha(color: string, a: number): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color);
  if (!m) return color;
  return `alpha(var(${m[1]}),${Math.max(0, Math.min(1, a))})`;
}

/** Animación de entrada suave; las actualizaciones (filtros, toques) no la repiten. */
export const ANIMATION = {
  animation: true,
  animationDuration: 650,
  animationEasing: "cubicOut",
  animationDurationUpdate: 220,
  animationEasingUpdate: "cubicOut",
} as const;

export const axisLabel = { color: T.muted, fontFamily: FONT, fontSize: LABEL_SIZE } as const;

/** Eje de valores: sin líneas, etiquetas pequeñas y tenues, rejilla muy suave. */
export function valueAxis(o: { min?: number; max?: number; interval?: number; inverse?: boolean; format?: (v: number) => string; splitNumber?: number; show?: boolean } = {}) {
  return {
    type: "value",
    show: o.show ?? true,
    min: o.min,
    max: o.max,
    interval: o.interval,
    splitNumber: o.interval ? undefined : (o.splitNumber ?? 3),
    inverse: o.inverse ?? false,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...axisLabel, margin: 6, hideOverlap: true, ...(o.format ? { formatter: o.format } : {}) },
    splitLine: { lineStyle: { color: T.grid, width: 1 } },
  };
}

/** Eje de categorías: sin línea ni marcas; `every` = una etiqueta de cada N. */
export function categoryAxis(data: string[], o: { every?: number; format?: (v: string) => string; show?: boolean } = {}) {
  return {
    type: "category",
    data,
    show: o.show ?? true,
    boundaryGap: true,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...axisLabel, interval: o.every ? o.every - 1 : "auto", hideOverlap: true, ...(o.format ? { formatter: o.format } : {}) },
  };
}

/** Eje de tiempo (ms) con etiquetas regulares ya calculadas (ver time-ticks.ts). */
export function timeAxis(o: { min: number; max: number; ticks: number[]; format: (v: number) => string; show?: boolean }) {
  return {
    type: "time",
    show: o.show ?? true,
    min: o.min,
    max: o.max,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { ...axisLabel, customValues: o.ticks, formatter: o.format },
  };
}

/** Degradado vertical transparente (de `top` arriba a 0 abajo). */
export function fade(color: string, top = 0.26, mid = 0.06) {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: alpha(color, top) },
      { offset: 0.55, color: alpha(color, mid) },
      { offset: 1, color: alpha(color, 0) },
    ],
  };
}

/** Brillo del punto bajo el cursor (solo aparece al tocar; no hay puntos en cada muestra). */
function glow(color: string) {
  return {
    focus: "none",
    scale: 1.6,
    itemStyle: { color, borderColor: T.surface, borderWidth: 2, shadowBlur: 12, shadowColor: alpha(color, 0.6) },
  };
}

/** Línea suave de 2 px; relleno con degradado opcional; puntos solo en el cursor o los indicados. */
export function lineSeries(o: {
  data: unknown[];
  color?: string;
  area?: boolean;
  smooth?: number | boolean;
  dashed?: boolean;
  width?: number;
  name?: string;
  /** mostrar puntos en los datos (p. ej. datos reales sueltos) */
  points?: boolean;
  step?: "start" | "middle" | "end";
  z?: number;
  areaOrigin?: "start" | "end" | "auto";
}) {
  const color = o.color ?? T.accent;
  return {
    type: "line",
    name: o.name,
    data: o.data,
    smooth: o.step ? false : (o.smooth ?? SMOOTH),
    step: o.step,
    connectNulls: false,
    showSymbol: o.points ?? false,
    symbol: "circle",
    symbolSize: o.points ? 6 : 8,
    itemStyle: { color, borderColor: T.surface, borderWidth: o.points ? 1.5 : 0 },
    lineStyle: { width: o.width ?? LINE_WIDTH, color, cap: "round", join: "round", ...(o.dashed ? { type: [5, 4] } : {}) },
    areaStyle: o.area ? { origin: o.areaOrigin ?? "auto", color: fade(color) } : undefined,
    emphasis: glow(color),
    z: o.z,
  };
}

/** Degradado sutil para una barra (de su color arriba a algo más transparente abajo). */
export function barFill(color: string) {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color },
      { offset: 1, color: alpha(color, 0.62) },
    ],
  };
}

export const BAR_RADIUS: [number, number, number, number] = [6, 6, 2, 2];

/** Estilo de una barra: esquinas superiores redondeadas, degradado y, si es la actual, acento con brillo. */
export function barItem(o: { color?: string; current?: boolean; selected?: boolean; top?: boolean }) {
  const color = o.current ? T.accent : (o.color ?? T.bar);
  return {
    color: barFill(color),
    borderRadius: o.top === false ? 0 : BAR_RADIUS,
    borderColor: o.selected ? T.text : "transparent",
    borderWidth: o.selected ? 1.5 : 0,
    ...(o.current ? { shadowBlur: 14, shadowColor: alpha(T.accent, 0.45) } : {}),
  };
}

/** Serie de barras con espacio entre ellas. */
export function barSeries(o: { data: unknown[]; name?: string; stack?: string; gap?: string; maxWidth?: number; z?: number }) {
  return {
    type: "bar",
    name: o.name,
    data: o.data,
    stack: o.stack,
    barCategoryGap: o.gap ?? "38%",
    barMaxWidth: o.maxWidth ?? 34,
    emphasis: { disabled: true },
    z: o.z,
  };
}

/**
 * Línea de referencia (objetivo, media): fina, discontinua, con la etiqueta a un lado y por
 * encima de la línea, para no tapar datos.
 */
export function refLine(o: { value: number; label?: string; side?: "start" | "end"; axis?: "y" | "x" }) {
  return {
    silent: true,
    symbol: "none",
    lineStyle: { color: T.ref, type: [4, 4], width: 1 },
    label: o.label
      ? { show: true, formatter: o.label, color: T.muted, fontFamily: FONT, fontSize: LABEL_SIZE, position: o.side === "start" ? "insideStartTop" : "insideEndTop", distance: 3 }
      : { show: false },
    data: [o.axis === "x" ? { xAxis: o.value } : { yAxis: o.value }],
  };
}

/**
 * Posición del tooltip: encima del dedo y desplazado a un lado, dentro del gráfico; si no cabe
 * encima, debajo. Nunca sobre el punto tocado.
 */
export function tooltipPosition(point: [number, number], size: { contentSize: [number, number]; viewSize: [number, number] }): [number, number] {
  const [x, y] = point;
  const [w, h] = size.contentSize;
  const [vw, vh] = size.viewSize;
  const gap = 14;
  let left = x + gap;
  if (left + w > vw) left = x - gap - w;
  left = Math.max(0, Math.min(left, vw - w));
  let top = y - h - gap;
  if (top < 0) top = Math.min(vh - h, y + gap);
  return [left, Math.max(0, top)];
}

/** Tooltip único y compacto para toda la app (con fondo desenfocado). */
export function tooltip(o: { trigger?: "axis" | "item"; formatter?: unknown; pointer?: boolean } = {}) {
  return {
    show: true,
    trigger: o.trigger ?? "axis",
    confine: true,
    backgroundColor: "alpha(var(--card),0.86)",
    borderColor: "var(--line-strong)",
    borderWidth: 1,
    padding: [6, 10],
    extraCssText: "border-radius:12px;box-shadow:0 10px 26px -12px rgba(0,0,0,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);",
    textStyle: { color: T.text, fontFamily: FONT, fontSize: 12 },
    position: (point: [number, number], _p: unknown, _d: unknown, _r: unknown, size: { contentSize: [number, number]; viewSize: [number, number] }) =>
      tooltipPosition(point, size),
    axisPointer:
      o.pointer === false
        ? { type: "none" }
        : { type: "line", lineStyle: { color: T.accent, width: 1 }, label: { show: false }, z: 0 },
    formatter: o.formatter,
  };
}

/** Cabecera del tooltip (fecha o periodo) y una fila de valor. */
export const tipHead = (s: string) => `<div style="font-size:11px;opacity:.7;margin-bottom:2px">${s}</div>`;
export const tipRow = (value: string, label?: string, color?: string) =>
  `<div style="display:flex;align-items:center;gap:6px;line-height:1.35">${color ? `<span style="width:7px;height:7px;border-radius:50%;background:${color}"></span>` : ""}${label ? `<span style="opacity:.7">${label}</span>` : ""}<b style="font-family:'Space Grotesk';font-size:14px">${value}</b></div>`;

/** Opción base: animación común y tipografía. */
export function baseOption(grid: { left?: number; right?: number; top?: number; bottom?: number }) {
  return {
    ...ANIMATION,
    textStyle: { fontFamily: FONT },
    grid: { left: grid.left ?? 36, right: grid.right ?? 10, top: grid.top ?? 12, bottom: grid.bottom ?? 22, containLabel: false },
  };
}

/** Ids estables por posición (series, ejes, visualMap) para actualizar sin recrear (EChart.tsx). */
export function withIds(opt: Record<string, unknown>): Record<string, unknown> {
  const out = { ...opt };
  for (const key of ["series", "xAxis", "yAxis", "visualMap"]) {
    const v = out[key];
    if (v === undefined || v === null) continue;
    const list = Array.isArray(v) ? v : [v];
    const named = list.map((x, i) => (x && typeof x === "object" && !("id" in x) ? { ...x, id: `${key}-${i}` } : x));
    out[key] = Array.isArray(v) ? named : named[0];
  }
  return out;
}
