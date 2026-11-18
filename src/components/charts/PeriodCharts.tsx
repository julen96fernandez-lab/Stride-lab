"use client";

import { Segmented } from "@/components/ui/Segmented";
import { useMemo, useState } from "react";
import type { Period, PeriodUnit } from "@/lib/analysis/periods";
import { movingAverage } from "@/lib/analysis/insights";
import { SESSION_TYPES, TYPE_META } from "@/lib/analysis/session-type";
import { SessionIcon } from "@/components/ui/SessionType";
import { EChart } from "./EChart";
import { T, baseOption, barItem, barSeries, categoryAxis, lineSeries, refLine, tipHead, tipRow, tooltip, valueAxis } from "./theme";
import { injuryAreaItems } from "./injury";
import { regularAxis } from "@/lib/analysis/axis";

/** Orden fijo de las capas apiladas (la paleta de tipos), más «sin tipo» al final. */
const STACK = [...SESSION_TYPES, "sin_tipo"] as const;
const stackColor = (t: string) => (t === "sin_tipo" ? T.bar : TYPE_META[t as keyof typeof TYPE_META].color);
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
  // Selección ligada a los datos: al cambiar de filtro vuelve al periodo actual sin remontar el
  // gráfico (así no se repite la animación de entrada).
  const dataKey = `${unit}:${periods.length}:${periods[0]?.start}`;
  const [selS, setSelS] = useState({ k: dataKey, i: periods.length - 1 });
  const sel = selS.k === dataKey ? selS.i : periods.length - 1;
  const setSel = (i: number) => setSelS({ k: dataKey, i });
  const [byType, setByType] = useState(false);
  const p = periods[Math.min(sel, periods.length - 1)];
  const many = periods.length > 14;
  const stackable = unit !== "year";
  const stacked = byType && stackable;
  const ma = unit === "week" ? movingAverage(periods.map((x) => x.km), 4) : null;
  const typesShown = STACK.filter((t) => periods.some((x) => (x.kmByType[t] ?? 0) > 0));

  // ¿Hay una banda de lesión en las últimas columnas? Entonces la etiqueta del objetivo va a la izquierda.
  const bandAtEnd = injuryRanges.some(([, z]) => z >= periods.length - 3);
  const goalLine = useMemo(
    () => (goalKm ? refLine({ value: goalKm, label: `Objetivo ${km1(goalKm)} km`, side: bandAtEnd ? "start" : "end" }) : undefined),
    [goalKm, bandAtEnd],
  );
  // Fondo en un eje numérico oculto (columna i = [i − 0,5, i + 0,5]) para cubrir columnas
  // enteras: bandas «Lesión» y, en la vista por tipo, la columna seleccionada. Va al fondo
  // (z 0), así no tapa barras, media móvil ni la línea del objetivo.
  const backdrop = useMemo(() => {
    const items = injuryAreaItems(injuryRanges.map(([a, z]): [number, number] => [a - 0.5, z + 0.5]));
    if (byType && unit !== "year" && periods[sel]) {
      items.push([{ xAxis: sel - 0.5, itemStyle: { color: "var(--ov-2)" }, label: { show: false } }, { xAxis: sel + 0.5 }]);
    }
    return items;
  }, [injuryRanges, byType, unit, periods, sel]);

  const bars = useMemo(() => {
    // Esquinas redondeadas solo en el segmento de arriba de cada columna apilada.
    const topIdx = periods.map((x) => {
      let top = -1;
      typesShown.forEach((t, k) => {
        if ((x.kmByType[t] ?? 0) > 0) top = k;
      });
      return top;
    });
    const gap = many ? "24%" : "38%";
    return {
      ...baseOption({ left: 30, right: 6, top: 14, bottom: 22 }),
      tooltip: tooltip({
        pointer: false,
        formatter: (ps: { dataIndex: number }[]) => {
          const x = periods[ps[0].dataIndex];
          return tipHead(unit === "week" ? `Semana del ${x.label}` : x.label) + tipRow(x.runs ? `${km1(x.km)} km` : "Sin carreras");
        },
      }),
      xAxis: [
        {
          ...categoryAxis(periods.map((x) => x.label)),
          axisLabel: {
            ...categoryAxis([]).axisLabel,
            interval: many ? 3 : unit === "year" ? 0 : 1, // 12 semanas o 12 meses: una etiqueta sí y otra no
            formatter: (v: string) => (unit === "month" ? v.split(" ")[0] : unit === "year" ? `'${v.slice(2)}` : v),
          },
        },
        { type: "value", show: false, min: -0.5, max: periods.length - 0.5 },
      ],
      // La línea de objetivo siempre visible, aunque esté por encima de todas las barras.
      yAxis: valueAxis({ max: goalKm ? Math.ceil(Math.max(goalKm, ...periods.map((x) => x.km)) * 1.12) : undefined }),
      series: [
        ...(backdrop.length
          ? [{ type: "line", xAxisIndex: 1, data: [], showSymbol: false, silent: true, z: 0, markArea: { silent: true, z: 0, data: backdrop } }]
          : []),
        ...(stacked
          ? typesShown.map((t, k) => ({
              ...barSeries({
                name: stackLabel(t),
                stack: "km",
                gap,
                data: periods.map((x, i) => ({
                  value: Math.round((x.kmByType[t] ?? 0) * 10) / 10,
                  itemStyle: { ...barItem({ color: stackColor(t), top: topIdx[i] === k }), borderColor: "var(--card)", borderWidth: 1 },
                })),
              }),
              markLine: k === 0 ? goalLine : undefined,
            }))
          : [
              {
                ...barSeries({
                  gap,
                  data: periods.map((x, i) => ({ value: Math.round(x.km * 10) / 10, itemStyle: barItem({ current: x.current, selected: i === sel }) })),
                }),
                markLine: goalLine,
              },
            ]),
        ...(ma
          ? [{ ...lineSeries({ name: "Media móvil 4 semanas", data: ma.map((v) => (v === null ? null : Math.round(v * 10) / 10)), color: T.text, smooth: 0.3, width: 1.5 }), z: 5 }]
          : []),
      ],
    };
  }, [periods, sel, goalKm, many, unit, stacked, typesShown, ma, goalLine, backdrop]);

  const paceVals = periods.map((x) => x.paceSPerKm);
  const known = paceVals.filter((v): v is number => v !== null);
  const paceAxis = useMemo(() => regularAxis(known, 3), [known]);
  const pace = useMemo(
    () => ({
      ...baseOption({ left: 30, right: 6, top: 8, bottom: 6 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const x = periods[ps[0].dataIndex];
          return tipHead(x.label) + tipRow(x.paceSPerKm ? `${paceStr(x.paceSPerKm)} /km` : "Sin ritmo");
        },
      }),
      xAxis: categoryAxis(
        periods.map((x) => x.label),
        { show: false },
      ),
      // Más arriba = más rápido; marcas regulares cada 15/30 s.
      yAxis: valueAxis({ min: paceAxis.min, max: paceAxis.max, interval: paceAxis.interval, inverse: true, format: (v) => paceStr(v) }),
      series: [
        {
          // Un punto por periodo con datos reales; el tocado, más grande.
          ...lineSeries({ data: paceVals, points: true }),
          symbolSize: (_: unknown, ps: { dataIndex: number }) => (ps.dataIndex === sel ? 10 : 6),
        },
      ],
    }),
    [periods, paceVals, sel, paceAxis],
  );

  return (
    <div>
      {stackable && (
        <div className="mb-2 flex justify-end">
          <Segmented
            label="Vista de barras"
            value={byType ? "tipo" : "total"}
            onChange={(k) => setByType(k === "tipo")}
            items={[
              { key: "total", label: "Total" },
              { key: "tipo", label: "Por tipo" },
            ]}
          />
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
      <EChart option={pace} height={92} label="Ritmo medio por periodo" onSelect={setSel} />

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
