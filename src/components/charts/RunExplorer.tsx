"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Explorer } from "@/lib/db/queries";
import type { RouteShape } from "@/lib/db/queries";
import { nearestIndex, niceXStep } from "@/lib/analysis/run-stream";
import { regularAxis } from "@/lib/analysis/axis";
import { RouteMap, type MapApi } from "@/components/map/RouteMap";
import type { EChartsCoreOption } from "echarts/core";
import { C, EChart, axisLabel } from "./EChart";
import { IntervalsCard } from "./IntervalsCard";

/** Márgenes del área de dibujo, iguales en todos los gráficos: así el cursor es una sola línea. */
const L = 44;
const R = 14;
const ZONE_COLORS = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)"];

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
        ? { silent: true, data: [[{ xAxis: xAt(selRange.t0), itemStyle: { color: "var(--ov-2)" } }, { xAxis: xAt(selRange.t1) }]] }
        : undefined,
    [selRange, xAt],
  );

  // ─── Opciones de cada gráfico ──────────────────────────────────────────────
  const base = useCallback(
    (last: boolean) => ({
      animation: false,
      grid: { left: L, right: R, top: 8, bottom: last ? 24 : 6 },
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
  const pts = useCallback(
    (vals: (number | null)[]) => {
      const out: (number | string)[][] = [];
      for (let i = 0; i < xs.length; i++) out.push([xs[i], vals[i] ?? "-"]);
      return out;
    },
    [xs],
  );

  const charts: { key: string; title: string; unit: string; height: number; option: EChartsCoreOption }[] = [];
  const paceVals = useMemo(() => (data.coarsePace ? data.t.map((t) => splitPaceAt(t)) : data.pace), [data, splitPaceAt]);
  const hasPace = paceVals.some((p) => p !== null);
  const order = [hasPace && "pace", data.hr && "hr", data.ele && "ele", data.power && "power"].filter(Boolean) as string[];
  const lastKey = order[order.length - 1] ?? "";

  const paceOpt = useMemo(() => {
    if (!hasPace) return null;
    const vals = [...paceVals, ...(showGap && data.gap ? data.gap : [])].filter((v): v is number => v !== null);
    // Rango robusto: sin dejar que unos pocos segundos lentos aplasten la curva.
    const sorted = [...vals].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const ax = regularAxis([lo, hi, ...(data.avgPace ? [data.avgPace] : [])], 4);
    return {
      ...base(lastKey === "pace"),
      yAxis: {
        type: "value",
        inverse: true,
        min: ax.min,
        max: ax.max,
        interval: ax.interval,
        axisLabel: { ...axisLabel, formatter: (v: number) => paceStr(v) },
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [
        {
          type: "line",
          data: pts(paceVals),
          showSymbol: false,
          connectNulls: false,
          step: data.coarsePace ? "end" : undefined,
          lineStyle: { width: 2, color: C.lime },
          markArea: selArea,
          markLine: data.avgPace
            ? {
                silent: true,
                symbol: "none",
                lineStyle: { color: C.text, type: [4, 4], width: 1, opacity: 0.7 },
                label: { formatter: `Medio ${paceStr(data.avgPace)}`, color: C.axis, fontFamily: C.font, fontSize: 10, position: "insideEndTop" },
                data: [{ yAxis: data.avgPace }],
              }
            : undefined,
          clip: true,
        },
        ...(showGap && data.gap
          ? [{ type: "line", data: pts(data.gap), showSymbol: false, connectNulls: false, lineStyle: { width: 1.6, color: C.text, type: [5, 3] }, clip: true }]
          : []),
      ],
    };
  }, [paceVals, showGap, data, base, pts, selArea, hasPace, lastKey]);

  const hrOpt = useMemo(() => {
    if (!data.hr) return null;
    const vals = data.hr.filter((v): v is number => v !== null);
    const ax = regularAxis([Math.min(...vals), Math.max(...vals)], 3, [10, 20, 25, 50]);
    const lim = data.zoneLimits;
    const bounds = [0, lim[1], lim[2], lim[3], lim[4], 260];
    return {
      ...base(lastKey === "hr"),
      yAxis: { type: "value", min: ax.min, max: ax.max, interval: ax.interval, axisLabel, splitLine: { show: false } },
      series: [
        {
          type: "line",
          data: pts(data.hr),
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.8, color: C.text },
          clip: true,
          // Zonas de fondo (Z1…Z5) y, encima, el parcial tocado.
          markArea: {
            silent: true,
            data: [
              ...ZONE_COLORS.map((c, i) => [
                { yAxis: bounds[i], itemStyle: { color: c, opacity: 0.16 } },
                { yAxis: bounds[i + 1] },
              ]),
              ...(selArea ? selArea.data : []),
            ],
          },
        },
      ],
    };
  }, [data, base, pts, selArea, lastKey]);

  const eleOpt = useMemo(() => {
    if (!data.ele) return null;
    const vals = data.ele.filter((v): v is number => v !== null);
    const ax = regularAxis([Math.min(...vals), Math.max(...vals)], 3, [5, 10, 20, 25, 50, 100, 200]);
    return {
      ...base(lastKey === "ele"),
      yAxis: { type: "value", min: ax.min, max: ax.max, interval: ax.interval, axisLabel, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        {
          type: "line",
          data: pts(data.ele),
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: C.fg3 },
          areaStyle: { color: C.fg3, opacity: 0.18 },
          markArea: selArea,
          clip: true,
        },
      ],
    };
  }, [data, base, pts, selArea, lastKey]);

  const powerOpt = useMemo(() => {
    if (!data.power) return null;
    const vals = data.power.filter((v): v is number => v !== null);
    const sorted = [...vals].sort((a, b) => a - b);
    const ax = regularAxis([sorted[Math.floor(sorted.length * 0.01)], sorted[Math.floor(sorted.length * 0.99)]], 3, [25, 50, 100]);
    return {
      ...base(lastKey === "power"),
      yAxis: { type: "value", min: ax.min, max: ax.max, interval: ax.interval, axisLabel, splitLine: { lineStyle: { color: C.grid } } },
      series: [{ type: "line", data: pts(data.power), showSymbol: false, connectNulls: false, lineStyle: { width: 1.4, color: "var(--z4)" }, markArea: selArea, clip: true }],
    };
  }, [data, base, pts, selArea, lastKey]);

  if (paceOpt) charts.push({ key: "pace", title: data.coarsePace ? "Ritmo por parciales" : "Ritmo", unit: "/km", height: 150, option: paceOpt });
  if (hrOpt) charts.push({ key: "hr", title: "Pulso", unit: "ppm · zonas de fondo", height: 120, option: hrOpt });
  if (eleOpt) charts.push({ key: "ele", title: "Altitud", unit: "m", height: 96, option: eleOpt });
  if (powerOpt) charts.push({ key: "power", title: "Potencia", unit: "W", height: 100, option: powerOpt });

  // ─── Cursor sincronizado (sin re-renderizar React) ─────────────────────────
  const wrap = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const rKm = useRef<HTMLSpanElement>(null);
  const rTime = useRef<HTMLSpanElement>(null);
  const rPace = useRef<HTMLSpanElement>(null);
  const rGap = useRef<HTMLSpanElement>(null);
  const rHr = useRef<HTMLSpanElement>(null);
  const rEle = useRef<HTMLSpanElement>(null);
  const rPower = useRef<HTMLSpanElement>(null);
  const rZone = useRef<HTMLSpanElement>(null);
  const rZoneDot = useRef<HTMLSpanElement>(null);
  const rHint = useRef<HTMLParagraphElement>(null);
  const frame = useRef(0);
  const pendingX = useRef<number | null>(null);
  const lastIdx = useRef<number | null>(null);

  const show = useCallback(
    (i: number) => {
      const w = wrap.current;
      if (!w || i < 0) return;
      lastIdx.current = i;
      const plotW = w.clientWidth - L - R;
      const px = L + ((xs[i] - xMin) / (xMax - xMin)) * plotW;
      if (line.current) {
        line.current.style.transform = `translateX(${px}px)`;
        line.current.style.opacity = "1";
      }
      const set = (el: HTMLElement | null, v: string) => {
        if (el && el.textContent !== v) el.textContent = v;
      };
      set(rKm.current, kmStr(data.km[i]));
      set(rTime.current, clock(data.t[i]));
      set(rPace.current, paceStr(data.coarsePace ? splitPaceAt(data.t[i]) : data.pace[i]));
      if (data.gap) set(rGap.current, paceStr(data.gap[i]));
      set(rHr.current, intStr(data.hr?.[i]));
      set(rEle.current, intStr(data.ele?.[i]));
      set(rPower.current, intStr(data.power?.[i]));
      const z = data.zone?.[i] ?? null;
      set(rZone.current, z === null ? "—" : `Z${z}`);
      if (rZoneDot.current) rZoneDot.current.style.background = z === null ? "transparent" : `var(--z${z})`;
      if (rHint.current) rHint.current.style.display = "none";
      mapApi.current?.setCursor(data.lat?.[i] ?? null, data.lon?.[i] ?? null);
    },
    [xs, xMin, xMax, data, splitPaceAt],
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
          {/* Lectura del instante señalado: fija arriba mientras se desliza. */}
          <div className="sticky top-2 z-10 -mx-1 rounded-2xl border border-line bg-[var(--card)] px-3 py-2.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]" aria-live="off">
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
              <Read label="Distancia" unit="km" refEl={rKm} />
              <Read label="Tiempo" refEl={rTime} />
              <Read label="Ritmo" unit="/km" refEl={rPace} lime />
              <Read label="Pulso" unit="ppm" refEl={rHr} />
              <Read label="Altitud" unit="m" refEl={rEle} />
              <Read label="Zona" refEl={rZone} dotEl={rZoneDot} />
              {data.gap && showGap && <Read label="Ajustado" unit="/km" refEl={rGap} />}
              {data.power && <Read label="Potencia" unit="W" refEl={rPower} />}
            </dl>
            <p ref={rHint} className="mt-1 text-[11px] text-fg-2">
              Desliza el dedo por los gráficos.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
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
                    className={`min-h-[34px] rounded-full px-3 ${axis === k ? "bg-lime text-lime-ink" : "text-fg-2"}`}
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
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--fg)] transition ${showGap ? "left-[18px]" : "left-0.5"}`} />
                </span>
                Ajustado por pendiente
              </button>
            )}
          </div>

          <div ref={wrap} className="relative mt-3 select-none">
            {charts.map((c) => (
              <div key={c.key} className="mb-1">
                <div className="flex items-baseline justify-between px-1">
                  <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-2 uppercase">{c.title}</span>
                  <span className="text-[11px] text-fg-2">{c.unit}</span>
                </div>
                <EChart option={c.option} height={c.height} label={`${c.title} a lo largo de la carrera`} />
              </div>
            ))}
            {/* Capa que recoge el dedo encima de los gráficos: ECharts no procesa cada movimiento.
                pan-y deja hacer scroll vertical; el arrastre horizontal mueve el cursor. */}
            <div
              className="absolute inset-0 z-[1]"
              style={{ touchAction: "pan-y" }}
              onPointerDown={onPointer}
              onPointerMove={onPointer}
              aria-hidden="true"
            />
            <div
              ref={line}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-6 left-0 z-[2] w-[1.5px] bg-[var(--fg)] opacity-0"
              style={{ willChange: "transform" }}
            />
          </div>
          <Legend coarse={data.coarsePace} gap={!!data.gap && showGap} avg={data.avgPace !== null} />
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

function Read({
  label,
  unit,
  refEl,
  dotEl,
  lime,
}: {
  label: string;
  unit?: string;
  refEl: React.RefObject<HTMLSpanElement | null>;
  dotEl?: React.RefObject<HTMLSpanElement | null>;
  lime?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-[0.06em] text-fg-2 uppercase">{label}</dt>
      <dd className="flex items-baseline gap-1">
        {dotEl && <span ref={dotEl} className="h-2.5 w-2.5 flex-none self-center rounded-full" aria-hidden="true" />}
        <span ref={refEl} className={`num text-[17px] ${lime ? "text-lime-text" : ""}`}>
          —
        </span>
        {unit && <span className="text-[10px] text-fg-2">{unit}</span>}
      </dd>
    </div>
  );
}

function Legend({ coarse, gap, avg }: { coarse: boolean; gap: boolean; avg: boolean }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-fg-2" aria-label="Leyenda">
      <li className="flex items-center gap-1.5">
        <span className="h-[3px] w-4 rounded" style={{ background: "var(--chart-line)" }} />
        {coarse ? "Ritmo por parciales (muestras cada ~5 min)" : "Ritmo suavizado (~30 s)"}
      </li>
      {avg && (
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t border-dashed" style={{ borderColor: "var(--fg)" }} />
          Ritmo medio
        </li>
      )}
      {gap && (
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--fg)" }} />
          Ajustado por pendiente
        </li>
      )}
      {!coarse && <li>Sin ritmo en pausas y muestras inválidas.</li>}
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
