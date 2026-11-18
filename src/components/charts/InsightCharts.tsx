"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useEffect } from "react";
import type { CalendarDay, PacePoint } from "@/lib/analysis/insights";
import { intensityLevels } from "@/lib/analysis/insights";
import { TYPE_META, isSessionType } from "@/lib/analysis/session-type";
import { SessionIcon } from "@/components/ui/SessionType";
import { C, EChart } from "./EChart";
import { ChartEmpty } from "./ChartEmpty";
import { T, baseOption, lineSeries, tipHead, tipRow, tooltip, valueAxis, timeAxis, axisLabel } from "./theme";
import { timeTicks } from "@/lib/analysis/time-ticks";
import { regularAxis } from "@/lib/analysis/axis";
import { injuryMarkArea } from "./injury";
import { bandsToMs, isInjuryDay, type InjuryBand } from "@/lib/analysis/injuries";

const paceStr = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const km1 = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDate = (t: number | string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(typeof t === "number" ? new Date(t) : new Date(`${t}T12:00:00Z`))
    .replace(".", "");
const dur = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(t % 60).padStart(2, "0")}`;
};
const typeColor = (t: string | null) => (isSessionType(t) ? TYPE_META[t].color : C.fg3);
const typeName = (t: string | null) => (isSessionType(t) ? TYPE_META[t].label : "Sin tipo");

// ─── Evolución del ritmo ─────────────────────────────────────────────────────

/** Un punto por carrera (color de su tipo) y la tendencia suavizada. Tocar un punto la muestra. */
export function PaceTrend({
  points,
  trend,
  bands = [],
  nowMs,
}: {
  points: PacePoint[];
  trend: { t: number; pace: number }[];
  bands?: InjuryBand[];
  nowMs: number;
}) {
  const [picked, setSel] = useState<PacePoint | null>(null);
  // Si el punto elegido ya no está (otro rango o tipo), el último: sin remontar el gráfico.
  const sel = picked && points.some((p) => p.id === picked.id) ? picked : (points.at(-1) ?? null);
  const option = useMemo(() => {
    const paces = points.map((p) => p.pace);
    const tFirst = points[0]?.t ?? nowMs;
    const tLast = points.at(-1)?.t ?? nowMs;
    const pad = Math.max(3 * 86_400_000, (tLast - tFirst) * 0.03);
    const [x0, x1] = [tFirst - pad, tLast + pad];
    const ticks = timeTicks(x0, x1);
    const yAx = regularAxis(paces, 4);
    return {
      ...baseOption({ left: 36, right: 10, top: 12, bottom: 24 }),
      tooltip: tooltip({
        trigger: "item",
        pointer: false,
        formatter: (e: { seriesIndex: number; dataIndex: number }) => {
          if (e.seriesIndex !== 0) return "";
          const p = points[e.dataIndex];
          return tipHead(`${fmtDate(p.t)} · ${typeName(p.type)}${p.inInjury ? " · lesión" : ""}`) + tipRow(`${paceStr(p.pace)} /km`, `${km1(p.km)} km`);
        },
      }),
      xAxis: timeAxis({ min: x0, max: x1, ticks: ticks.values, format: ticks.label }),
      // Más arriba = más rápido; marcas regulares cada 15/30 s.
      yAxis: valueAxis({ min: yAx.min, max: yAx.max, interval: yAx.interval, inverse: true, format: (v) => paceStr(v) }),
      series: [
        {
          type: "scatter",
          data: points.map((p) => ({
            value: [p.t, p.pace],
            symbolSize: p.id === sel?.id ? 12 : 7,
            itemStyle: {
              color: typeColor(p.type),
              borderColor: p.id === sel?.id ? T.text : T.surface,
              borderWidth: p.id === sel?.id ? 2 : 1,
              shadowBlur: p.id === sel?.id ? 12 : 0,
              shadowColor: typeColor(p.type),
              // En lesión: visibles pero apagados (no cuentan en la tendencia).
              opacity: p.inInjury ? 0.35 : 1,
            },
          })),
          markArea: points.length
            ? injuryMarkArea(bandsToMs(bands, points[0].t, points[points.length - 1].t, nowMs), points[0].t, points[points.length - 1].t)
            : undefined,
          z: 3,
        },
        { ...lineSeries({ data: trend.map((x) => [x.t, Math.round(x.pace)]), smooth: 0.4, z: 4 }), silent: true },
      ],
    };
  }, [points, trend, sel, bands, nowMs]);

  if (points.length === 0) return <ChartEmpty message="Sin carreras en este periodo con ese tipo." height={150} />;
  return (
    <div>
      <EChart option={option} height={210} label="Ritmo medio de cada carrera y tendencia" onItem={(si, di) => si === 0 && setSel(points[di])} />
      <p className="mt-1 px-1 text-[11px] text-fg-2">
        Cada punto es una carrera; la línea es la tendencia suavizada{trend.length === 0 ? " (hacen falta 3 carreras)" : ""}. Más arriba = más rápido.
        {points.some((p) => p.inInjury) && " Los puntos apagados son de periodos de lesión y no cuentan en la tendencia."}
      </p>
      {sel && (
        <Link
          href={`/actividad/${sel.id}`}
          className="mt-3 flex min-h-[56px] items-center gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2.5 active:opacity-70"
        >
          {isSessionType(sel.type) && (
            <span className="flex" style={{ color: typeColor(sel.type) }}>
              <SessionIcon type={sel.type} size={18} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-fg-2 first-letter:uppercase">
              {fmtDate(sel.t)} · {typeName(sel.type)}
              {sel.inInjury ? " · lesión" : ""}
            </div>
            <div className="mt-0.5 text-[14px]">
              <b className="num text-[17px]">{paceStr(sel.pace)}</b> /km · {km1(sel.km)} km{sel.avgHr ? ` · ${Math.round(sel.avgHr)} ppm` : ""}
            </div>
          </div>
          <span className="text-[13px] font-semibold text-fg-2">Ver</span>
        </Link>
      )}
    </div>
  );
}

// ─── Calendario de constancia ────────────────────────────────────────────────

const LEVEL_MIX = [0, 42, 62, 82, 100];

/** Mapa de calor: columnas = semanas (lun→dom), casilla = día. Gris = sin correr. */
export function ConsistencyCalendar({ days, metric, bands = [] }: { days: CalendarDay[]; metric: "km" | "load"; bands?: InjuryBand[] }) {
  const levels = useMemo(() => intensityLevels(days.map((d) => (metric === "km" ? d.km : d.load))), [days, metric]);
  const [sel, setSel] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth }); // empieza por lo más reciente
  }, []);

  const weeks: { day: CalendarDay; i: number }[][] = [];
  days.forEach((day, i) => {
    if (day.weekday === 0 || !weeks.length) weeks.push([]);
    weeks[weeks.length - 1].push({ day, i });
  });
  const runDays = days.filter((d) => d.runs.length).length;
  const s = sel === null ? null : days[sel];

  return (
    <div>
      <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <div className="flex gap-[3px]" role="grid" aria-label="Días de los últimos 12 meses">
          <div className="mr-1 flex flex-col gap-[3px] pt-[16px] text-[9px] leading-[16px] text-fg-2" aria-hidden="true">
            {["L", "", "X", "", "V", "", "D"].map((l, i) => (
              <span key={i} className="h-4">
                {l}
              </span>
            ))}
          </div>
          {weeks.map((w, wi) => {
            const first = w[0].day.date;
            const newMonth = wi === 0 || first.slice(5, 7) !== weeks[wi - 1][0].day.date.slice(5, 7);
            return (
              <div key={first} className="flex flex-col gap-[3px]" role="row">
                <span className="h-[13px] text-[9px] whitespace-nowrap text-fg-2" aria-hidden="true">
                  {newMonth ? MONTHS[Number(first.slice(5, 7)) - 1] : ""}
                </span>
                {Array.from({ length: 7 }, (_, wd) => {
                  const cell = w.find((x) => x.day.weekday === wd);
                  if (!cell) return <span key={wd} className="h-4 w-4" />;
                  const lv = levels[cell.i];
                  const active = sel === cell.i;
                  const hurt = isInjuryDay(cell.day.date, bands);
                  return (
                    <button
                      key={wd}
                      type="button"
                      role="gridcell"
                      onClick={() => setSel(active ? null : cell.i)}
                      aria-label={`${fmtDate(cell.day.date)}: ${cell.day.runs.length ? `${km1(cell.day.km)} km` : "sin correr"}${hurt ? ", lesión" : ""}`}
                      aria-selected={active}
                      className={`h-4 w-4 rounded-[4px] ${active ? "ring-2 ring-[var(--fg)] ring-offset-1 ring-offset-[var(--card)]" : ""}`}
                      style={{
                        background: lv === 0 ? "var(--ov-2)" : `color-mix(in srgb, var(--chart-line) ${LEVEL_MIX[lv]}%, var(--ov-2))`,
                        // Día en periodo de lesión: contorno gris fuera de la casilla (no tapa su color).
                        outline: hurt ? "1px solid var(--fg-3)" : undefined,
                        outlineOffset: hurt ? 1 : undefined,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-fg-2">
        <span>
          {runDays} días con carrera de {days.length}
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          menos
          {LEVEL_MIX.map((m, i) => (
            <span
              key={i}
              className="h-3 w-3 rounded-[3px]"
              style={{ background: i === 0 ? "var(--ov-2)" : `color-mix(in srgb, var(--chart-line) ${m}%, var(--ov-2))` }}
            />
          ))}
          más
        </span>
      </div>
      {bands.length > 0 && days.some((d) => isInjuryDay(d.date, bands)) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-2">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--ov-2)", outline: "1px solid var(--fg-3)", outlineOffset: 1 }} />
          Día en periodo de lesión
        </div>
      )}
      <div aria-live="polite">
        {s && (
          <div className="mt-3 rounded-2xl border border-line bg-inset p-3.5">
            <div className="text-[13px] font-semibold first-letter:uppercase">
              {fmtDate(s.date)}
              {isInjuryDay(s.date, bands) && <span className="ml-2 rounded-full bg-ov-2 px-2 py-0.5 text-[10px] font-bold text-fg-2">LESIÓN</span>}
            </div>
            {s.runs.length === 0 ? (
              <p className="mt-1 text-[13px] text-fg-2">Sin correr.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {s.runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/actividad/${r.id}`} className="flex min-h-[44px] items-center gap-2.5 active:opacity-70">
                      {isSessionType(r.type) && (
                        <span className="flex" style={{ color: typeColor(r.type) }}>
                          <SessionIcon type={r.type} size={16} />
                        </span>
                      )}
                      <span className="flex-1 text-[14px]">
                        <b className="num">{km1(r.km)} km</b> · {dur(r.durationS)} · {typeName(r.type)}
                      </span>
                      <span className="text-[12px] text-fg-2">{r.load !== null ? `carga ${Math.round(r.load)}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Comparación de años ─────────────────────────────────────────────────────

/** Km acumulados día a día: año actual (hasta hoy) frente al anterior (completo). */
export function YearCumulative({
  year,
  current,
  previous,
  bands = [],
}: {
  year: number;
  current: number[];
  previous: number[];
  /** Periodos de lesión del año actual en días del año [inicio, fin]. */
  bands?: [number, number][];
}) {
  const option = useMemo(() => {
    const toPts = (arr: number[], y: number) => arr.map((v, d) => [Date.UTC(2000, 0, 1) + d * 86_400_000, Math.round(v * 10) / 10, y]);
    return {
      ...baseOption({ left: 40, right: 54, top: 12, bottom: 24 }),
      tooltip: tooltip({
        formatter: (ps: { value: [number, number]; seriesIndex: number }[]) => {
          const d = new Date(ps[0].value[0]);
          return (
            tipHead(`${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`) +
            ps.map((p) => tipRow(`${km1(p.value[1])} km`, String(p.seriesIndex === 0 ? year : year - 1), p.seriesIndex === 0 ? "var(--chart-line)" : "var(--fg-3)")).join("")
          );
        },
      }),
      xAxis: {
        type: "time",
        min: Date.UTC(2000, 0, 1),
        max: Date.UTC(2000, 11, 31),
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisLabel, formatter: (v: number) => MONTHS[new Date(v).getUTCMonth()], hideOverlap: true },
      },
      yAxis: valueAxis(),
      series: [
        {
          ...lineSeries({ name: String(year), data: toPts(current, year), area: true }),
          endLabel: { show: true, formatter: String(year), color: T.text, fontFamily: C.font, fontSize: 10, fontWeight: 600 },
          markArea: injuryMarkArea(
            bands.map(([a, z]): [number, number] => [Date.UTC(2000, 0, 1) + a * 86_400_000, Date.UTC(2000, 0, 1) + (z + 1) * 86_400_000]),
            Date.UTC(2000, 0, 1),
            Date.UTC(2000, 11, 31),
          ),
          z: 3,
        },
        {
          ...lineSeries({ name: String(year - 1), data: toPts(previous, year - 1), color: "var(--fg-3)", dashed: true }),
          endLabel: { show: true, formatter: String(year - 1), color: T.muted, fontFamily: C.font, fontSize: 10 },
          z: 2,
        },
      ],
    };
  }, [year, current, previous, bands]);
  return (
    <div>
      <EChart option={option} height={200} label={`Km acumulados en ${year} frente a ${year - 1}`} />
      <ul className="mt-1 flex gap-4 px-1 text-[11px] text-fg-2" aria-label="Leyenda">
        <li className="flex items-center gap-1.5">
          <span className="h-[3px] w-5 rounded" style={{ background: "var(--chart-line)" }} />
          {year} (hasta hoy)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: "var(--fg-3)" }} />
          {year - 1}
        </li>
        {bands.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-sm" style={{ background: "var(--ov-2)", outline: "1px solid var(--line-strong)" }} />
            Lesión
          </li>
        )}
      </ul>
    </div>
  );
}
