"use client";

import { useMemo, useState } from "react";
import type { Period, PeriodUnit } from "@/lib/analysis/periods";
import { C, EChart, axisLabel, tooltipBase } from "./EChart";

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
export function PeriodCharts({ periods, unit, goalKm }: { periods: Period[]; unit: PeriodUnit; goalKm: number | null }) {
  const [sel, setSel] = useState(periods.length - 1);
  const p = periods[Math.min(sel, periods.length - 1)];
  const many = periods.length > 14;

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
          markLine: goalKm
            ? {
                symbol: "none",
                silent: true,
                lineStyle: { color: C.text, type: [4, 4], width: 1.2, opacity: 0.8 },
                label: { formatter: `Objetivo ${km1(goalKm)} km`, color: C.axis, fontFamily: C.font, fontSize: 10, position: "insideEndTop" },
                data: [{ yAxis: goalKm }],
              }
            : undefined,
        },
      ],
    }),
    [periods, sel, goalKm, many, unit],
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
      <EChart option={bars} height={170} label={`Kilómetros por ${UNIT_NAME[unit][0].toLowerCase()}`} onSelect={setSel} />
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
