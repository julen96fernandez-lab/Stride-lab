"use client";

import { useMemo, useState } from "react";
import type { Period, PeriodUnit } from "@/lib/analysis/periods";
import { movingAverage } from "@/lib/analysis/insights";
import { SESSION_TYPES, TYPE_META } from "@/lib/analysis/session-type";
import { SessionIcon } from "@/components/ui/SessionType";
import { C, EChart, axisLabel, tooltipBase } from "./EChart";
import { injuryAreaItems } from "./injury";

/** Orden fijo de las capas apiladas (la paleta de tipos), más «sin tipo» al final. */
const STACK = [...SESSION_TYPES, "sin_tipo"] as const;
const stackColor = (t: string) => (t === "sin_tipo" ? C.bar : TYPE_META[t as keyof typeof TYPE_META].color);
const stackLabel = (t: string) => (t === "sin_tipo" ? "Sin tipo" : TYPE_META[t as keyof typeof TYPE_META].label);

const paceStr = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const km1 = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const dur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};
const UNIT_NAME: Record<PeriodUnit, [string, string]> = {
  week: ["Semana", "semana del"],
  month: ["Mes", ""],
  year: ["Año", ""],
};
const ZONE_NAMES = ["Z1", "Z2", "Z3", "Z4", "Z5"];

/**
 * Km por periodo (barras, periodo actual en lima, línea de objetivo) y, debajo y alineado,
 * el ritmo medio (línea; sin sesiones especiales). Dos gráficos con el mismo eje X en lugar
 * de un gráfico con dos escalas. Tocar una columna muestra su detalle.
 */
export function PeriodCharts({
  periods,
  unit,
  goalKm,
  injuryRanges = [],
}: {
  periods: Period[];
  unit: PeriodUnit;
  goalKm: number | null;
  /** Columnas [primera, última] que se solapan con un periodo de lesión. */
  injuryRanges?: [number, number][];
}) {
  const [sel, setSel] = useState(periods.length - 1);
  const [byType, setByType] = useState(false);
  const p = periods[Math.min(sel, periods.length - 1)];
  const many = periods.length > 14;
  const stackable = unit !== "year";
  const stacked = byType && stackable;
  const ma = unit === "week" ? movingAverage(periods.map((x) => x.km), 4) : null;
  const typesShown = STACK.filter((t) => periods.some((x) => (x.kmByType[t] ?? 0) > 0));

  const goalLine = useMemo(
    () =>
      goalKm
        ? {
            symbol: "none",
            silent: true,
            lineStyle: { color: C.text, type: [4, 4], width: 1.2, opacity: 0.8 },
            label: { formatter: `Objetivo ${km1(goalKm)} km`, color: C.axis, fontFamily: C.font, fontSize: 10, position: "insideEndTop" },
            data: [{ yAxis: goalKm }],
          }
        : undefined,
    [goalKm],
  );
  // Columna seleccionada en la vista por tipo (el periodo actual se indica en el detalle).
  const injuryItems = useMemo(
    () => injuryAreaItems(injuryRanges.map(([a, z]): [string, string] => [periods[a].label, periods[z].label])),
    [periods, injuryRanges],
  );
  // Columna seleccionada (solo en la vista por tipo) y bandas «Lesión», en la misma markArea.
  const selArea = useMemo(
    () => ({
      silent: true,
      data: [
        ...(byType && unit !== "year" ? [[{ xAxis: periods[sel]?.label, itemStyle: { color: "var(--ov-2)" } }, { xAxis: periods[sel]?.label }]] : []),
        ...injuryItems,
      ],
    }),
    [periods, sel, byType, unit, injuryItems],
  );

  const bars = useMemo(
    () => ({
      grid: { left: 30, right: 6, top: 14, bottom: 22 },
      tooltip: { show: false },
      xAxis: {
        type: "category",
        data: periods.map((x) => x.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          ...axisLabel,
          interval: many ? 3 : unit === "month" ? 1 : unit === "year" && periods.length > 7 ? 0 : 0,
          formatter: (v: string) => (unit === "month" ? v.split(" ")[0] : unit === "year" ? `'${v.slice(2)}` : v),
        },
      },
      yAxis: {
        type: "value",
        splitNumber: 3,
        // La línea de objetivo siempre visible, aunque esté por encima de todas las barras.
        max: goalKm ? Math.ceil(Math.max(goalKm, ...periods.map((x) => x.km)) * 1.12) : undefined,
        axisLabel,
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [
        ...(stacked
          ? typesShown.map((t, k) => ({
              name: stackLabel(t),
              type: "bar",
              stack: "km",
              barCategoryGap: many ? "22%" : "30%",
              data: periods.map((x) => Math.round((x.kmByType[t] ?? 0) * 10) / 10),
              itemStyle: {
                color: stackColor(t),
                borderColor: C.surface,
                borderWidth: 1,
                borderRadius: k === typesShown.length - 1 ? [4, 4, 0, 0] : 0,
              },
              markLine: k === 0 ? goalLine : undefined,
              markArea: k === 0 ? selArea : undefined,
            }))
          : [
              {
                type: "bar",
                barCategoryGap: many ? "22%" : "30%",
                data: periods.map((x, i) => ({
                  value: Math.round(x.km * 10) / 10,
                  itemStyle: {
                    color: x.current ? C.lime : C.bar,
                    borderRadius: [5, 5, 2, 2],
                    borderColor: i === sel ? C.text : "transparent",
                    borderWidth: i === sel ? 1.5 : 0,
                  },
                })),
                markLine: goalLine,
                markArea: injuryItems.length ? { silent: true, data: injuryItems } : undefined,
              },
            ]),
        ...(ma
          ? [
              {
                name: "Media móvil 4 semanas",
                type: "line",
                data: ma.map((v) => (v === null ? null : Math.round(v * 10) / 10)),
                connectNulls: false,
                showSymbol: false,
                smooth: 0.3,
                lineStyle: { color: C.text, width: 1.6 },
                z: 5,
              },
            ]
          : []),
      ],
    }),
    [periods, sel, goalKm, many, unit, stacked, typesShown, ma, goalLine, selArea, injuryItems],
  );

  const paceVals = periods.map((x) => x.paceSPerKm);
  const known = paceVals.filter((v): v is number => v !== null);
  const pace = useMemo(
    () => ({
      grid: { left: 30, right: 6, top: 8, bottom: 6 },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: C.pointer } },
        formatter: (ps: { dataIndex: number }[]) => {
          const x = periods[ps[0].dataIndex];
          return `<div style="color:${C.axis};font-size:11px">${x.label}</div><b>${x.paceSPerKm ? `${paceStr(x.paceSPerKm)} /km` : "Sin ritmo"}</b>`;
        },
      },
      xAxis: { type: "category", data: periods.map((x) => x.label), show: false, boundaryGap: true },
      yAxis: {
        type: "value",
        inverse: true, // más arriba = más rápido
        min: known.length ? Math.floor(Math.min(...known) / 15) * 15 - 15 : 240,
        max: known.length ? Math.ceil(Math.max(...known) / 15) * 15 + 15 : 420,
        splitNumber: 2,
        axisLabel: { ...axisLabel, formatter: (v: number) => paceStr(v) },
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [
        {
          type: "line",
          data: paceVals,
          connectNulls: false,
          symbol: "circle",
          symbolSize: (_: unknown, ps: { dataIndex: number }) => (ps.dataIndex === sel ? 9 : 5),
          lineStyle: { width: 2, color: C.lime },
          itemStyle: { color: C.lime, borderColor: C.surface, borderWidth: 1.5 },
        },
      ],
    }),
    [periods, paceVals, known, sel],
  );

  return (
    <div>
      {stackable && (
        <div className="mb-2 flex justify-end">
          <div className="flex rounded-full border border-line-strong p-0.5 text-[12px] font-semibold" role="group" aria-label="Vista de barras">
            {[
              [false, "Total"],
              [true, "Por tipo"],
            ].map(([v, label]) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={byType === v}
                onClick={() => setByType(v as boolean)}
                className={`min-h-[32px] rounded-full px-3 ${byType === v ? "bg-lime text-lime-ink" : "text-fg-2"}`}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>
      )}
      <EChart
        option={bars}
        height={stacked ? 190 : 170}
        label={`Kilómetros por ${UNIT_NAME[unit][0].toLowerCase()}${stacked ? " y tipo" : ""}`}
        onSelect={setSel}
      />
      {(stacked || ma || injuryRanges.length > 0) && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1" aria-label="Leyenda">
          {stacked &&
            typesShown.map((t) => (
              <li key={t} className="flex items-center gap-1 text-[11px] text-fg-2">
                {t === "sin_tipo" ? (
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--chart-bar)" }} />
                ) : (
                  <span className="flex" style={{ color: stackColor(t) }}>
                    <SessionIcon type={t as (typeof SESSION_TYPES)[number]} size={12} />
                  </span>
                )}
                {stackLabel(t)}
              </li>
            ))}
          {ma && (
            <li className="flex items-center gap-1 text-[11px] text-fg-2">
              <span className="h-[2px] w-4 rounded" style={{ background: "var(--fg)" }} />
              Media móvil 4 semanas
            </li>
          )}
          {injuryRanges.length > 0 && (
            <li className="flex items-center gap-1 text-[11px] text-fg-2">
              <span className="h-2.5 w-3 rounded-sm" style={{ background: "var(--ov-2)", outline: "1px solid var(--line-strong)" }} />
              Lesión
            </li>
          )}
        </ul>
      )}
      <div className="mt-1 flex items-baseline justify-between px-1">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-2 uppercase">Ritmo medio</span>
        <span className="text-[11px] text-fg-2">más arriba = más rápido · sin especiales</span>
      </div>
      <EChart option={pace} height={78} label="Ritmo medio por periodo" onSelect={setSel} />

      {/* Detalle del periodo tocado */}
      <section aria-live="polite" className="mt-4 rounded-2xl border border-line bg-inset p-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[13px] font-semibold">
            {unit === "week" ? `Semana del ${p.label}` : unit === "month" ? p.label : p.label}
            {p.current && <span className="ml-2 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-ink">ACTUAL</span>}
            {injuryRanges.some(([a, z]) => Math.min(sel, periods.length - 1) >= a && Math.min(sel, periods.length - 1) <= z) && (
              <span className="ml-2 rounded-full bg-ov-2 px-2 py-0.5 text-[10px] font-bold text-fg-2">LESIÓN</span>
            )}
          </div>
          <span className="text-[12px] text-fg-2">
            {p.runs} {p.runs === 1 ? "carrera" : "carreras"}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3">
          <D label="Km" value={p.runs ? km1(p.km) : "—"} />
          <D label="Ritmo medio" value={p.paceSPerKm ? paceStr(p.paceSPerKm) : "—"} unit={p.paceSPerKm ? "/km" : undefined} />
          <D label="Tiempo" value={p.runs ? dur(p.durationS) : "—"} />
          <D label="FC media" value={p.avgHr ? String(Math.round(p.avgHr)) : "—"} unit={p.avgHr ? "ppm" : undefined} />
          <D label="Desnivel +" value={p.elevationGainM !== null ? String(Math.round(p.elevationGainM)) : "—"} unit={p.elevationGainM !== null ? "m" : undefined} />
          <D label="Carga" value={p.load !== null ? String(Math.round(p.load)) : "—"} />
        </dl>
        {Object.keys(p.kmByType).length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-semibold tracking-[0.06em] text-fg-2 uppercase">Km por tipo</div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {STACK.filter((t) => (p.kmByType[t] ?? 0) > 0).map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  style={{ borderColor: `color-mix(in srgb, ${stackColor(t)} 45%, transparent)` }}
                >
                  {t !== "sin_tipo" && (
                    <span className="flex" style={{ color: stackColor(t) }}>
                      <SessionIcon type={t as (typeof SESSION_TYPES)[number]} size={12} />
                    </span>
                  )}
                  {stackLabel(t)} {km1(p.kmByType[t])} km
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <div className="text-[11px] font-semibold tracking-[0.06em] text-fg-2 uppercase">Tiempo en zonas</div>
          {p.zoneSeconds ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {p.zoneSeconds.map((sec, i) => {
                const max = Math.max(...p.zoneSeconds!);
                return (
                  <li key={i} className="grid grid-cols-[26px_1fr_64px] items-center gap-2">
                    <span className="num text-[12px]" style={{ color: `var(--z${i + 1})` }}>
                      {ZONE_NAMES[i]}
                    </span>
                    <div className="h-2 overflow-hidden rounded-full bg-ov-2">
                      <div className="h-full rounded-full" style={{ width: `${max ? (100 * sec) / max : 0}%`, background: `var(--z${i + 1})` }} />
                    </div>
                    <span className="text-right text-[12px] text-fg-2">{sec >= 60 ? dur(sec) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-fg-2">Sin muestras de pulso en este periodo.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function D({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-2">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1">
        <span className={`num text-[18px] ${value === "—" ? "text-fg-3" : ""}`}>{value}</span>
        {unit && <span className="text-[10px] text-fg-2">{unit}</span>}
      </dd>
    </div>
  );
}
