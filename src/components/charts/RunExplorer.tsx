"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Explorer } from "@/lib/db/queries";
import type { RouteShape } from "@/lib/db/queries";
import { hrAxisFrom60, hrSegments, nearestIndex, nearestWithin, niceXStep, noDataRanges, paceAxisRange } from "@/lib/analysis/run-stream";
import { zoneOf, type HrZones } from "@/lib/analysis/hr-zones";
import { regularAxis } from "@/lib/analysis/axis";
import { RouteMap, type MapApi } from "@/components/map/RouteMap";
import type { EChartsCoreOption } from "echarts/core";
import { C, EChart } from "./EChart";
import { ANIMATION, T, axisLabel } from "./theme";
import { IntervalsCard } from "./IntervalsCard";

/** Márgenes del área de dibujo, iguales en todos los gráficos: así el cursor es una sola línea. */
const L = 40;
const R = 12;
const TOP = 8;
const BOTTOM = 6;
const BOTTOM_LAST = 22;

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` : `${m}:${String(t % 60).padStart(2, "0")}`;
};
const paceStr = (s: number | null | undefined) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const kmStr = (k: number | null | undefined, d = 2) => (k === null || k === undefined ? "—" : k.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
const intStr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(Math.round(v)));

type Axis = "dist" | "time";

export function RunExplorer({
  data,
  route,
}: {
  data: Explorer;
  route: { points: [number, number][]; bbox: readonly [number | null, number | null, number | null, number | null]; shape: RouteShape | null } | null;
}) {
  const hasKm = data.km.some((k) => k !== null && k > 0);
  const [axis, setAxis] = useState<Axis>(hasKm ? "dist" : "time");
  const [showGap, setShowGap] = useState(false);
  // Tramo tocado: un parcial («km:3») o un paso de las series («step:1.2.0»).
  const [sel, setSel] = useState<string | null>(null);
  const mapApi = useRef<MapApi | null>(null);

  // Eje X: km (rellenando el inicio sin distancia con 0, no decreciente) o tiempo en s.
  const xs = useMemo(() => {
    if (axis === "time") return data.t;
    let last = 0;
    return data.km.map((k) => (k === null ? last : (last = Math.max(last, k))));
  }, [axis, data]);
  const xMin = xs[0] ?? 0;
  const xMax = Math.max(xs[xs.length - 1] ?? 1, xMin + 1e-6);
  /** x de un instante t (s): para los tramos de los parciales. */
  const xAt = useCallback((t: number) => xs[Math.max(0, nearestIndex(data.t, t))], [xs, data.t]);

  // Ritmo de los parciales (carreras antiguas): escalera con un valor por parcial.
  const splitPaceAt = useCallback(
    (t: number) => data.splits.find((s) => t >= s.t0 && t <= s.t1)?.paceSPerKm ?? null,
    [data.splits],
  );

  const selRange = useMemo(() => {
    if (!sel) return null;
    if (sel.startsWith("km:")) return data.splits.find((s) => `km:${s.idx}` === sel) ?? null;
    const rows = data.intervals?.ok ? data.intervals.rows : [];
    return rows.find((r) => `step:${r.key}` === sel) ?? null;
  }, [sel, data]);
  const selArea = useMemo(
    () =>
      selRange
        ? { silent: true, data: [[{ xAxis: xAt(selRange.t0), itemStyle: { color: "alpha(var(--chart-line),0.14)" } }, { xAxis: xAt(selRange.t1) }]] }
        : undefined,
    [selRange, xAt],
  );

  // ─── Opciones de cada gráfico (mismo estilo en día y noche) ─────────────────
  const base = useCallback(
    (last: boolean) => ({
      ...ANIMATION,
      grid: { left: L, right: R, top: TOP, bottom: last ? BOTTOM_LAST : BOTTOM },
      tooltip: { show: false },
      xAxis: {
        type: "value",
        min: xMin,
        max: xMax,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        interval: niceXStep(xMax - xMin, axis),
        axisLabel: last
          ? {
              ...axisLabel,
              fontSize: 10,
              hideOverlap: true,
              showMaxLabel: false,
              formatter: (v: number) =>
                axis === "dist"
                  ? `${kmStr(v, v % 1 ? 1 : 0)} km`
                  : v < 3600
                    ? `${Math.round(v / 60)}′`
                    : `${Math.floor(v / 3600)} h ${String(Math.round((v % 3600) / 60)).padStart(2, "0")}′`,
            }
          : { show: false },
      },
    }),
    [xMin, xMax, axis],
  );
  const yLabel = { ...axisLabel, margin: 6 };
  const faint = { lineStyle: { color: T.grid, width: 1 } };
  const pts = useCallback(
    (vals: (number | null)[]) => {
      const out: (number | string)[][] = [];
      for (let i = 0; i < xs.length; i++) out.push([xs[i], vals[i] ?? "-"]);
      return out;
    },
    [xs],
  );
  /** x de un instante cualquiera (s), interpolando el eje de la rejilla (para las muestras de pulso). */
  const xOfT = useCallback(
    (t: number) => {
      const j = nearestIndex(data.t, t);
      if (j < 0) return xMin;
      const k = data.t[j] <= t ? Math.min(j + 1, data.t.length - 1) : Math.max(j - 1, 0);
      const [a, b] = j <= k ? [j, k] : [k, j];
      if (data.t[b] === data.t[a]) return xs[a];
      return xs[a] + ((t - data.t[a]) / (data.t[b] - data.t[a])) * (xs[b] - xs[a]);
    },
    [data.t, xs, xMin],
  );
  const grad = (color: string, top: number, bottom = 0) => ({
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `alpha(${color},${top})` },
      { offset: 1, color: `alpha(${color},${bottom})` },
    ],
  });
  const zonePieces = useMemo(() => {
    const l = data.zoneLimits;
    return [
      { lt: l[1], color: "var(--z1)" },
      { gte: l[1], lt: l[2], color: "var(--z2)" },
      { gte: l[2], lt: l[3], color: "var(--z3)" },
      { gte: l[3], lt: l[4], color: "var(--z4)" },
      { gte: l[4], color: "var(--z5)" },
    ];
  }, [data.zoneLimits]);

  const paceVals = useMemo(() => (data.coarsePace ? data.t.map((t) => splitPaceAt(t)) : data.pace), [data, splitPaceAt]);
  const hasPace = paceVals.some((p) => p !== null);
  // Pulso por parciales si las muestras son muy pocas (y los parciales tienen pulso).
  const hrBySplits = data.hrSparse && data.splits.some((s) => s.avgHr !== null);
  const hrStep = useMemo(
    () => (hrBySplits ? data.t.map((t) => data.splits.find((s) => t >= s.t0 && t <= s.t1)?.avgHr ?? null) : null),
    [hrBySplits, data],
  );
  const hasHr = !!data.hrRaw || !!hrStep;
  const order = [hasPace && "pace", hasHr && "hr", data.ele && "ele", data.power && "power"].filter(Boolean) as string[];
  const lastKey = order[order.length - 1] ?? "";

  const paceAx = useMemo(
    // Solo el ritmo real fija el eje: el ajustado por pendiente se recorta si se sale.
    () => paceAxisRange(paceVals, data.avgPace ? [data.avgPace] : []),
    [paceVals, data.avgPace],
  );
  // Tramos sin ritmo dentro de la carrera (pausas, muestras no fiables): banda tenue «sin datos».
  const gapBands = useMemo(
    () =>
      data.coarsePace
        ? []
        : noDataRanges(data.t, data.pace).map(([a, b]) => [
            {
              xAxis: xAt(a),
              itemStyle: { color: "alpha(var(--fg),0.045)" },
              label: { show: true, position: "insideTop", formatter: "sin datos", color: "alpha(var(--fg),0.45)", fontSize: 9, fontFamily: C.font },
            },
            { xAxis: xAt(b) },
          ]),
    [data, xAt],
  );
  const paceOpt = useMemo(() => {
    if (!hasPace || !paceAx) return null;
    return {
      ...base(lastKey === "pace"),
      yAxis: {
        type: "value",
        inverse: true,
        min: paceAx.min,
        max: paceAx.max,
        interval: paceAx.interval,
        axisLabel: { ...yLabel, formatter: (v: number) => paceStr(v) },
        splitLine: faint,
      },
      series: [
        {
          type: "line",
          data: pts(paceVals),
          showSymbol: false,
          connectNulls: false,
          smooth: data.coarsePace ? false : 0.35,
          step: data.coarsePace ? "end" : undefined,
          lineStyle: { width: 2, color: C.lime, cap: "round", join: "round" },
          // Degradado que se desvanece hacia abajo (también en la escalera por parciales).
          areaStyle: {
            origin: "end",
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "alpha(var(--chart-line),0.26)" },
                { offset: 0.55, color: "alpha(var(--chart-line),0.06)" },
                { offset: 1, color: "alpha(var(--chart-line),0)" },
              ],
            },
          },
          markArea: { silent: true, data: [...gapBands, ...(selArea ? selArea.data : [])] },
          // Ritmo medio: referencia fina, sin etiqueta dentro (va en la cabecera, no la tapa el cursor).
          markLine: data.avgPace
            ? { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "alpha(var(--fg),0.45)", type: [3, 4], width: 1 }, data: [{ yAxis: data.avgPace }] }
            : undefined,
          clip: true,
          z: 3,
        },
        ...(showGap && data.gap
          ? [{ type: "line", data: pts(data.gap), showSymbol: false, connectNulls: false, smooth: 0.5, lineStyle: { width: 1.2, color: "alpha(var(--fg),0.6)", cap: "round" }, clip: true, z: 2 }]
          : []),
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paceVals, paceAx, showGap, data, base, pts, selArea, gapBands, hasPace, lastKey]);

  const hrAx = useMemo(() => {
    // Por parciales: eje desde 60 ppm para no exagerar diferencias entre barras.
    if (hrStep) return hrAxisFrom60(hrStep);
    const vals = (data.hrRaw?.v ?? []).filter((v): v is number => v !== null);
    return vals.length ? regularAxis([Math.min(...vals), Math.max(...vals)], 3, [10, 20, 25, 50]) : null;
  }, [hrStep, data.hrRaw]);
  const hrOpt = useMemo(() => {
    if (!hasHr || !hrAx) return null;
    let series: object;
    if (hrStep) {
      // Barras por parcial (pulso medio de cada km), cada una del color de su zona.
      const l = data.zoneLimits;
      const zc = (h: number) => `alpha(var(--z${h < l[1] ? 1 : h < l[2] ? 2 : h < l[3] ? 3 : h < l[4] ? 4 : 5}),0.75)`;
      const known = data.splits.map((sp) => sp.avgHr).filter((h): h is number => h !== null);
      const ref = known.reduce((a, b) => a + b, 0) / Math.max(1, known.length);
      const bars = data.splits.map((sp) => {
        const x0 = xAt(sp.t0);
        const x1 = xAt(sp.t1);
        const pad = (x1 - x0) * 0.08;
        // Parcial sin pulso: barra tenue de referencia (a la altura de la media), sin color de zona.
        return sp.avgHr !== null
          ? [{ xAxis: x0 + pad, yAxis: hrAx.min, itemStyle: { color: zc(sp.avgHr), borderRadius: 3 } }, { xAxis: x1 - pad, yAxis: sp.avgHr }]
          : [
              { xAxis: x0 + pad, yAxis: hrAx.min, itemStyle: { color: "alpha(var(--fg),0.05)", borderColor: "alpha(var(--fg),0.14)", borderWidth: 1, borderType: "dashed", borderRadius: 3 } },
              { xAxis: x1 - pad, yAxis: ref },
            ];
      });
      series = {
        type: "line",
        data: pts(hrStep),
        showSymbol: false,
        lineStyle: { opacity: 0 },
        markArea: { silent: true, data: [...bars, ...(selArea ? selArea.data : [])] },
        clip: true,
      };
    } else {
      const sg = hrSegments(data.hrRaw!);
      const few = data.hrRaw!.t.length <= 600;
      series = {
        type: "line",
        data: sg.t.map((t, i) => [xOfT(t), sg.v[i] ?? "-"]),
        connectNulls: false,
        smooth: 0.3,
        showSymbol: few,
        symbol: "circle",
        symbolSize: 3,
        lineStyle: { width: 2, cap: "round", join: "round" },
        markArea: selArea,
        clip: true,
      };
    }
    return {
      ...base(lastKey === "hr"),
      yAxis: { type: "value", min: hrAx.min, max: hrAx.max, interval: hrAx.interval, axisLabel: yLabel, splitLine: faint },
      // La línea toma el color de la zona de cada tramo (sin fondos).
      visualMap: hrStep ? undefined : { type: "piecewise", show: false, dimension: 1, seriesIndex: 0, pieces: zonePieces },
      series: [series],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHr, hrAx, hrStep, data.hrRaw, data.splits, data.zoneLimits, base, pts, xOfT, xAt, selArea, lastKey, zonePieces]);

  const eleAx = useMemo(() => {
    const vals = (data.ele ?? []).filter((v): v is number => v !== null);
    return vals.length ? regularAxis([Math.min(...vals), Math.max(...vals)], 3, [5, 10, 20, 25, 50, 100, 200]) : null;
  }, [data.ele]);
  const eleOpt = useMemo(() => {
    if (!data.ele || !eleAx) return null;
    const g = data.grade;
    return {
      ...base(lastKey === "ele"),
      yAxis: { type: "value", min: eleAx.min, max: eleAx.max, interval: eleAx.interval, axisLabel: yLabel, splitLine: faint },
      series: [
        {
          type: "line",
          data: pts(data.ele),
          showSymbol: false,
          connectNulls: false,
          smooth: 0.4,
          // Perfil coloreado por pendiente (bajada azul, llano neutro, subida ámbar/roja) con un
          // degradado horizontal: una parada de color por tramo.
          lineStyle: { width: 2, cap: "round", join: "round", color: g ? slopeGradient(xs, data.ele!, g) : C.fg3 },
          areaStyle: { color: grad("var(--fg-3)", 0.3, 0.02) },
          markArea: selArea,
          clip: true,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, eleAx, base, xs, pts, selArea, lastKey]);

  const powerAx = useMemo(() => {
    const vals = (data.power ?? []).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return vals.length ? regularAxis([vals[Math.floor(vals.length * 0.02)], vals[Math.floor(vals.length * 0.98)]], 3, [25, 50, 100]) : null;
  }, [data.power]);
  const powerOpt = useMemo(() => {
    if (!data.power || !powerAx) return null;
    return {
      ...base(lastKey === "power"),
      yAxis: { type: "value", min: powerAx.min, max: powerAx.max, interval: powerAx.interval, axisLabel: yLabel, splitLine: faint },
      series: [
        {
          type: "line",
          data: pts(data.power),
          showSymbol: false,
          connectNulls: false,
          smooth: 0.35,
          lineStyle: { width: 2, color: "var(--z4)", cap: "round", join: "round" },
          areaStyle: { color: grad("var(--z4)", 0.25, 0) },
          markArea: selArea,
          clip: true,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.power, powerAx, base, pts, selArea, lastKey]);

  // Metadatos para colocar el punto con brillo sobre cada gráfico sin pedirle nada a ECharts.
  type ChartDef = {
    key: string;
    title: string;
    note: string;
    height: number;
    option: EChartsCoreOption;
    axis: { min: number; max: number; inverse: boolean };
    values: (number | null)[];
    color: string;
    lastKey: string;
  };
  const charts: ChartDef[] = [];
  const H = { pace: 150, hr: 118, ele: 104, power: 100 } as const;
  if (paceOpt && paceAx)
    charts.push({
      key: "pace",
      title: data.coarsePace ? "Ritmo por parciales" : "Ritmo",
      note: data.avgPace ? `/km · medio ${paceStr(data.avgPace)}` : "/km",
      height: H.pace,
      option: paceOpt as EChartsCoreOption,
      lastKey,
      axis: { min: paceAx.min, max: paceAx.max, inverse: true },
      values: paceVals,
      color: "var(--chart-line)",
    });
  if (hrOpt && hrAx)
    charts.push({
      key: "hr",
      title: hrStep ? "Pulso por parciales" : "Pulso",
      note: "ppm · color por zona",
      height: H.hr,
      option: hrOpt as EChartsCoreOption,
      lastKey,
      axis: { min: hrAx.min, max: hrAx.max, inverse: false },
      values: hrStep ?? data.hr ?? [],
      color: "var(--fg)",
    });
  if (eleOpt && eleAx)
    charts.push({ key: "ele", title: "Altitud", note: "m · color por pendiente", height: H.ele, option: eleOpt as EChartsCoreOption, lastKey, axis: { min: eleAx.min, max: eleAx.max, inverse: false }, values: data.ele ?? [], color: "var(--fg-2)" });
  if (powerOpt && powerAx)
    charts.push({ key: "power", title: "Potencia", note: "W", height: H.power, option: powerOpt as EChartsCoreOption, lastKey, axis: { min: powerAx.min, max: powerAx.max, inverse: false }, values: data.power ?? [], color: "var(--z4)" });

  // ─── Cursor sincronizado (sin re-renderizar React) ─────────────────────────
  const wrap = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const dots = useRef<Record<string, HTMLDivElement | null>>({});
  const rKm = useRef<HTMLSpanElement>(null);
  const rTime = useRef<HTMLSpanElement>(null);
  const rPace = useRef<HTMLSpanElement>(null);
  const rGap = useRef<HTMLSpanElement>(null);
  const rHr = useRef<HTMLSpanElement>(null);
  const rHrNote = useRef<HTMLSpanElement>(null);
  const rEle = useRef<HTMLSpanElement>(null);
  const rPower = useRef<HTMLSpanElement>(null);
  const rZone = useRef<HTMLSpanElement>(null);
  const rZoneDot = useRef<HTMLSpanElement>(null);
  const rHint = useRef<HTMLParagraphElement>(null);
  const frame = useRef(0);
  const pendingX = useRef<number | null>(null);
  const lastIdx = useRef<number | null>(null);
  const chartsRef = useRef(charts);
  useEffect(() => {
    chartsRef.current = charts;
  });

  const show = useCallback(
    (i: number) => {
      const w = wrap.current;
      if (!w || i < 0) return;
      lastIdx.current = i;
      const width = w.clientWidth;
      const plotW = width - L - R;
      const px = L + ((xs[i] - xMin) / (xMax - xMin)) * plotW;
      if (line.current) {
        line.current.style.transform = `translateX(${px}px)`;
        line.current.style.opacity = "1";
      }
      // Punto con brillo sobre cada gráfico.
      for (const c of chartsRef.current) {
        const el = dots.current[c.key];
        if (!el) continue;
        const v = c.values[i];
        if (v === null || v === undefined) {
          el.style.opacity = "0";
          continue;
        }
        const plotH = c.height - TOP - (c.key === c.lastKey ? BOTTOM_LAST : BOTTOM);
        let f = (v - c.axis.min) / (c.axis.max - c.axis.min);
        f = Math.min(1, Math.max(0, f));
        const y = TOP + (c.axis.inverse ? f : 1 - f) * plotH;
        el.style.transform = `translate(${px - 5}px, ${y - 5}px)`;
        el.style.opacity = "1";
      }
      const set = (el: HTMLElement | null, v: string) => {
        if (el && el.textContent !== v) el.textContent = v;
      };
      set(rKm.current, kmStr(data.km[i]));
      set(rTime.current, clock(data.t[i]));
      set(rPace.current, paceStr(data.coarsePace ? splitPaceAt(data.t[i]) : data.pace[i]));
      if (data.gap) set(rGap.current, paceStr(data.gap[i]));
      // Pulso y zona: si en este instante no hay dato, la muestra más cercana (≤ 60 s) con aviso.
      let hr = hrStep ? null : (data.hr?.[i] ?? null);
      let note = "";
      if (hrStep && hrStep[i] !== null) {
        hr = hrStep[i];
        note = "media del parcial";
      }
      if (hr === null && data.hrRaw) {
        const n = nearestWithin(data.hrRaw, data.t[i], 60);
        if (n) {
          hr = n.v;
          note = `muestra a ${Math.round(n.dt)} s`;
        }
      }
      set(rHr.current, intStr(hr));
      set(rHrNote.current, note);
      set(rEle.current, intStr(data.ele?.[i]));
      set(rPower.current, intStr(data.power?.[i]));
      const z = hr === null ? null : zoneOf(hr, data.zoneLimits as HrZones["limits"]);
      set(rZone.current, z === null ? "—" : `Z${z}`);
      if (rZoneDot.current) rZoneDot.current.style.background = z === null ? "transparent" : `var(--z${z})`;
      if (rHint.current) rHint.current.style.display = "none";
      if (strip.current) strip.current.style.opacity = "1";
      mapApi.current?.setCursor(data.lat?.[i] ?? null, data.lon?.[i] ?? null);
    },
    [xs, xMin, xMax, data, splitPaceAt, hrStep],
  );
  const onPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pendingX.current = e.clientX;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const w = wrap.current;
        const cx = pendingX.current;
        if (!w || cx === null) return;
        const r = w.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (cx - r.left - L) / (r.width - L - R)));
        show(nearestIndex(xs, xMin + f * (xMax - xMin)));
      });
    },
    [show, xs, xMin, xMax],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // Al cambiar de eje, el cursor se recoloca en el mismo instante.
  useEffect(() => {
    if (lastIdx.current !== null) show(lastIdx.current);
  }, [axis, show]);

  // Parcial tocado → tramo en el mapa.
  useEffect(() => {
    if (!data.lat || !data.lon) return;
    if (!selRange) return mapApi.current?.setHighlight(null);
    const seg: [number, number][] = [];
    for (let i = 0; i < data.t.length; i++) if (data.t[i] >= selRange.t0 && data.t[i] <= selRange.t1) seg.push([data.lat[i], data.lon[i]]);
    mapApi.current?.setHighlight(seg);
  }, [selRange, data]);

  return (
    <>
      {route ? (
        <section className="card p-2">
          <RouteMap points={route.points} bbox={route.bbox} shape={route.shape} apiRef={mapApi} />
        </section>
      ) : null}

      {charts.length > 0 && (
        <section className="card p-4" aria-label="Gráficos de la carrera">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {hasKm ? (
              <div className="flex rounded-full border border-line-strong p-0.5 text-[12px] font-semibold" role="group" aria-label="Eje horizontal">
                {(
                  [
                    ["dist", "Distancia"],
                    ["time", "Tiempo"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={axis === k}
                    onClick={() => setAxis(k)}
                    className={`min-h-[34px] rounded-full px-3 transition-colors ${axis === k ? "bg-lime text-lime-ink" : "text-fg-2"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            {data.gap && (
              <button
                type="button"
                role="switch"
                aria-checked={showGap}
                onClick={() => setShowGap((v) => !v)}
                className="flex min-h-[34px] items-center gap-2 text-[12px] font-semibold text-fg-2"
              >
                <span className={`relative h-5 w-9 rounded-full transition ${showGap ? "bg-lime" : "bg-ov-2"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--fg)] transition-all ${showGap ? "left-[18px]" : "left-0.5"}`} />
                </span>
                Ajustado por pendiente
              </button>
            )}
          </div>
          {/* Franja fija con el instante señalado: no tapa los gráficos (solo el punto brilla encima). */}
          <div
            className="sticky top-2 z-10 mt-3 rounded-2xl border border-line px-3 py-2 shadow-[0_10px_28px_-14px_rgba(0,0,0,0.5)] backdrop-blur-xl"
            style={{ background: "color-mix(in srgb, var(--card) 82%, transparent)" }}
          >
            <p ref={rHint} className="py-1 text-[12px] text-fg-2">
              Desliza el dedo por los gráficos.
            </p>
            <div ref={strip} aria-live="off" className="opacity-0 transition-opacity duration-150">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <Cell refEl={rPace} unit="/km" lime big />
                <Cell refEl={rKm} unit="km" />
                <Cell refEl={rTime} />
                {hasHr && (
                  <span className="flex items-baseline gap-1">
                    <span ref={rZoneDot} className="h-2 w-2 self-center rounded-full" aria-hidden="true" />
                    <Cell refEl={rHr} unit="ppm" />
                    <span ref={rZone} className="num text-[12px] text-fg-2">
                      —
                    </span>
                  </span>
                )}
                {data.ele && <Cell refEl={rEle} unit="m" />}
                {data.power && <Cell refEl={rPower} unit="W" />}
                {data.gap && showGap && (
                  <span className="text-[11px] text-fg-2">
                    ajust. <Cell refEl={rGap} />
                  </span>
                )}
              </div>
              <span ref={rHrNote} className="block text-[10px] leading-tight text-fg-2" />
            </div>
          </div>

          <div ref={wrap} className="relative mt-1 select-none">
            {charts.map((c) => (
              <div key={c.key} className="relative mb-1.5">
                <div className="flex items-baseline justify-between px-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-fg-2 uppercase">{c.title}</span>
                  <span className="text-[10px] text-fg-2">{c.note}</span>
                </div>
                <div className="relative">
                  <EChart option={c.option} height={c.height} label={`${c.title} a lo largo de la carrera`} merge />
                  <div
                    ref={(el) => {
                      dots.current[c.key] = el;
                    }}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 z-[2] h-[10px] w-[10px] rounded-full opacity-0 transition-opacity duration-150"
                    style={{
                      background: c.color,
                      boxShadow: `0 0 0 2px var(--card), 0 0 12px 3px color-mix(in srgb, ${c.color} 55%, transparent)`,
                      willChange: "transform",
                    }}
                  />
                </div>
              </div>
            ))}
            {/* Capa que recoge el dedo encima de los gráficos: ECharts no procesa cada movimiento.
                pan-y deja hacer scroll vertical; el arrastre horizontal mueve el cursor. */}
            <div
              className="absolute inset-0 z-[3]"
              style={{ touchAction: "pan-y" }}
              onPointerDown={onPointer}
              onPointerMove={onPointer}
              aria-hidden="true"
            />
            <div
              ref={line}
              aria-hidden="true"
              className="pointer-events-none absolute top-3 bottom-6 left-0 z-[1] w-px opacity-0 transition-opacity"
              style={{ willChange: "transform", background: "linear-gradient(to bottom, transparent, var(--chart-line) 8%, var(--chart-line) 92%, transparent)" }}
            />
          </div>
          <DistanceNote info={data.distanceInfo} />
          <Legend coarse={data.coarsePace} gap={!!data.gap && showGap} avg={data.avgPace !== null} hrBySplits={!!hrStep} ele={!!data.ele} />
        </section>
      )}

      {data.intervals && <IntervalsCard analysis={data.intervals} sel={sel} onSel={setSel} />}

      <SplitsTable
        splits={data.splits}
        sel={sel?.startsWith("km:") ? Number(sel.slice(3)) : null}
        onSel={(i) => setSel(i === null ? null : `km:${i}`)}
      />
    </>
  );
}

/** Color de un tramo según su pendiente. */
function slopeColor(g: number): string {
  if (g < -0.06) return "var(--z2)";
  if (g < -0.02) return "alpha(var(--z2),0.6)";
  if (g < 0.02) return "var(--fg-3)";
  if (g < 0.06) return "var(--z4)";
  return "var(--z5)";
}

/** Degradado horizontal con el color de la pendiente a lo largo del perfil (≤ ~240 paradas). */
function slopeGradient(xs: number[], ele: (number | null)[], grade: (number | null)[]) {
  const idx = xs.map((_, i) => i).filter((i) => ele[i] !== null);
  if (idx.length < 2) return "var(--fg-3)";
  const x0 = xs[idx[0]];
  const x1 = xs[idx[idx.length - 1]];
  const span = x1 - x0 || 1;
  const step = Math.max(1, Math.floor(idx.length / 240));
  const stops: { offset: number; color: string }[] = [];
  let prev = "";
  for (let k = 0; k < idx.length; k += step) {
    const i = idx[k];
    const c = slopeColor(grade[i] ?? 0);
    const off = Math.min(1, Math.max(0, (xs[i] - x0) / span));
    // Bordes nítidos entre tramos: la parada anterior se repite justo antes del cambio.
    if (prev && c !== prev) stops.push({ offset: off, color: prev });
    stops.push({ offset: off, color: c });
    prev = c;
  }
  return { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: stops };
}

function Cell({ refEl, unit, lime, big }: { refEl: React.RefObject<HTMLSpanElement | null>; unit?: string; lime?: boolean; big?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span ref={refEl} className={`num ${big ? "text-[20px]" : "text-[14px]"} ${lime ? "text-lime-text" : ""}`}>
        —
      </span>
      {unit && <span className="ml-0.5 text-[10px] text-fg-2">{unit}</span>}
    </span>
  );
}

/** Aviso de distancia: de dónde sale el eje de km y qué no registró el reloj. */
function DistanceNote({ info }: { info: Explorer["distanceInfo"] }) {
  const km = (m: number | null) => (m === null ? "—" : (m / 1000).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const parts: string[] = [];
  if (info.missing) {
    parts.push(
      `El reloj no registró distancia en ${info.missing.stretches} ${info.missing.stretches === 1 ? "tramo" : "tramos"} donde el GPS marca ${Math.round(info.missing.gpsM - info.missing.watchM)} m: ahí no hay ritmo (banda «sin datos»).`,
    );
  }
  if (info.kmFrom === "gps" && info.samplesM !== null)
    parts.push(`Eje de km con el GPS (${km(info.gpsM)} km): las muestras del reloj suman ${km(info.samplesM)} km y el total es ${km(info.totalM)} km.`);
  else if (info.samplesM !== null && info.totalM && Math.abs(info.samplesM - info.totalM) / info.totalM > 0.02)
    parts.push(`Las muestras del reloj suman ${km(info.samplesM)} km; el total del entrenamiento es ${km(info.totalM)} km.`);
  if (!parts.length) return null;
  return <p className="mt-2 px-1 text-[10px] leading-relaxed text-fg-2">{parts.join(" ")}</p>;
}

function Legend({ coarse, gap, avg, hrBySplits, ele }: { coarse: boolean; gap: boolean; avg: boolean; hrBySplits: boolean; ele: boolean }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[10px] text-fg-2" aria-label="Leyenda">
      <li className="flex items-center gap-1.5">
        <span className="h-[2px] w-4 rounded-full" style={{ background: "var(--chart-line)" }} />
        {coarse ? "Ritmo por parciales (muestras cada ~5 min)" : "Ritmo suavizado (mediana + media de ~30 s)"}
      </li>
      {avg && (
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t border-dashed" style={{ borderColor: "var(--fg-2)" }} />
          Medio
        </li>
      )}
      {gap && (
        <li className="flex items-center gap-1.5">
          <span className="h-px w-4 rounded-full" style={{ background: "var(--fg-2)" }} />
          Ajustado por pendiente
        </li>
      )}
      <li className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((z) => (
          <span key={z} className="h-2 w-2 rounded-full" style={{ background: `var(--z${z})` }} />
        ))}
        <span className="ml-0.5">pulso por zona{hrBySplits ? " (por parciales: pocas muestras)" : ""}</span>
      </li>
      {ele && (
        <li className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--z2)" }} />
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--fg-3)" }} />
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--z5)" }} />
          <span className="ml-0.5">bajada · llano · subida</span>
        </li>
      )}
      {!coarse && <li>Sin ritmo en pausas ni muestras imposibles.</li>}
    </ul>
  );
}

function SplitsTable({ splits, sel, onSel }: { splits: Explorer["splits"]; sel: number | null; onSel: (i: number | null) => void }) {
  if (splits.length === 0) {
    return (
      <section className="card p-5">
        <div className="eyebrow">Parciales por km</div>
        <p className="mt-2 text-[14px] text-fg-2">Sin datos de distancia suficientes para calcularlos.</p>
      </section>
    );
  }
  const hasHr = splits.some((s) => s.avgHr !== null);
  const hasElev = splits.some((s) => s.elevationGainM !== null);
  const cols = "grid-cols-[30px_50px_1fr_34px_40px]";
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Parciales por km</div>
        <span className="text-[11px] text-fg-2">Toca uno para verlo</span>
      </div>
      <div className={`mt-3 grid ${cols} items-center gap-x-2 text-[10px] font-semibold tracking-[0.06em] text-fg-2 uppercase`}>
        <span>Km</span>
        <span>Tiempo</span>
        <span>Ritmo</span>
        <span className="text-right">{hasHr ? "FC" : ""}</span>
        <span className="text-right">{hasElev ? "Desn." : ""}</span>
      </div>
      <ol className="mt-1">
        {splits.map((s) => {
          const active = sel === s.idx;
          return (
            <li key={s.idx}>
              <button
                type="button"
                onClick={() => onSel(active ? null : s.idx)}
                aria-pressed={active}
                aria-label={`Kilómetro ${s.idx}${s.fastest ? ", el más rápido" : ""}${s.slowest ? ", el más lento" : ""}`}
                className={`grid min-h-[38px] w-full ${cols} items-center gap-x-2 rounded-xl text-left ${active ? "bg-ov-2 ring-1 ring-[var(--line-strong)]" : ""}`}
              >
                <span className="num pl-1 text-[13px] text-fg-2">{s.partial ? kmStr(s.distanceM / 1000) : s.idx}</span>
                <span className="num text-[13px]">{clock(s.durationS)}</span>
                <span className="relative flex h-[26px] items-center">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-lg ${s.fastest ? "bg-lime" : s.slowest ? "" : "bg-ov-2"}`}
                    style={{
                      width: `${Math.round(s.bar * 100)}%`,
                      ...(s.slowest ? { background: "color-mix(in srgb, var(--z5) 28%, transparent)" } : {}),
                    }}
                  />
                  <span className={`num relative pl-2 text-[15px] ${s.fastest ? "text-lime-ink" : ""}`}>{paceStr(s.paceSPerKm)}</span>
                  {(s.fastest || s.slowest) && (
                    <span className={`relative ml-auto pr-1.5 text-[10px] font-bold ${s.fastest ? "text-lime-ink" : "text-fg-2"}`}>
                      {s.fastest ? "MÁS RÁPIDO" : "MÁS LENTO"}
                    </span>
                  )}
                </span>
                <span className="num text-right text-[13px] text-fg-2">{s.avgHr === null ? (hasHr ? "—" : "") : Math.round(s.avgHr)}</span>
                <span className="text-right text-[12px] text-fg-2">
                  {s.elevationGainM === null ? (hasElev ? "—" : "") : `+${Math.round(s.elevationGainM)}`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
