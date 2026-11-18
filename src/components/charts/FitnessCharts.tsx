"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EChart } from "./EChart";
import { ChartEmpty } from "./ChartEmpty";
import { ANIMATION, alpha, barItem, barSeries, baseOption, categoryAxis, lineSeries, refLine, tipHead, tipRow, tooltip, valueAxis } from "./theme";
import { Segmented } from "@/components/ui/Segmented";
import { RATIO_BANDS, STATE_LABEL, fmtRatio, viewPoints, type FitnessView, type LoadState } from "@/lib/analysis/fitness";
import { TYPE_META, isSessionType } from "@/lib/analysis/session-type";

export const STATE_COLOR: Record<LoadState, string> = {
  descansado: "var(--t-rodaje)",
  en_forma: "var(--chart-line)",
  cargado: "var(--load-mod)",
  sobrecargado: "var(--load-high)",
};
const ACUTE = "var(--load-mod)";
const FORM = "var(--fg-2)";

const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");
const n1 = (v: number) => v.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n1(Math.abs(v))}`;
const ap = (on: boolean) => (on ? "≈" : "");
const dayLabel = (iso: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", ...o }).format(new Date(`${iso}T00:00:00Z`));

/** Etiqueta del estado (píldora con su color). */
export function StatePill({ state, warmup }: { state: LoadState | null; warmup?: boolean }) {
  if (!state) return <span className="rounded-full border border-line-strong px-2.5 py-1 text-[12px] font-semibold text-fg-2">{warmup ? "En calentamiento" : "Sin datos"}</span>;
  const c = STATE_COLOR[state];
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}
    >
      {STATE_LABEL[state]}
      {warmup ? " ≈" : ""}
    </span>
  );
}

const RANGES = [
  { key: "3", label: "3 meses", days: 91 },
  { key: "6", label: "6 meses", days: 182 },
  { key: "12", label: "12 meses", days: 365 },
] as const;

/** Bandas de fondo por tramos seguidos del mismo estado. */
function stateBands(states: (LoadState | null)[], dates: string[]) {
  const out: unknown[] = [];
  let i = 0;
  while (i < states.length) {
    const st = states[i];
    let j = i;
    while (j + 1 < states.length && states[j + 1] === st) j++;
    if (st) out.push([{ xAxis: dates[i], itemStyle: { color: alpha(STATE_COLOR[st], 0.1) } }, { xAxis: dates[j] }]);
    i = j + 1;
  }
  return out;
}

/** Sección de Análisis: crónica, aguda y forma con bandas de estado; carga semanal. */
export function FitnessCard({ view }: { view: FitnessView }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("6");
  const days = RANGES.find((r) => r.key === range)!.days;
  const all = useMemo(() => viewPoints(view.cols), [view.cols]);
  const pts = useMemo(() => all.slice(-days), [all, days]);
  const [sel, setSel] = useState<number | null>(null);
  const picked = sel !== null && sel < pts.length ? pts[sel] : null;
  const cur = view.current;
  const c = view.counts;
  const anyApprox = pts.some((p) => p.approx);

  const option = useMemo(() => {
    const dates = pts.map((p) => p.date);
    const every = Math.max(1, Math.round(pts.length / 5));
    return {
      ...baseOption({ left: 34, right: 34, top: 14, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const p = pts[ps[0]?.dataIndex ?? 0];
          if (!p) return "";
          return (
            tipHead(dayLabel(p.date, { weekday: "short", day: "numeric", month: "short" })) +
            tipRow(`${ap(p.approx)}${n1(p.chronic)}`, "Crónica", "var(--chart-line)") +
            tipRow(`${ap(p.approx)}${n1(p.acute)}`, "Aguda", ACUTE) +
            tipRow(`${ap(p.approx)}${signed(p.form)}`, "Forma", FORM)
          );
        },
      }),
      xAxis: categoryAxis(dates, { every, format: (v) => dayLabel(v) }),
      yAxis: [valueAxis({ min: 0 }), { ...valueAxis({}), splitLine: { show: false } }],
      series: [
        {
          ...lineSeries({ data: pts.map((p) => +p.chronic.toFixed(2)), area: true, smooth: false, name: "Crónica", z: 3 }),
          markArea: { silent: true, data: stateBands(pts.map((p) => p.state), dates) },
        },
        lineSeries({ data: pts.map((p) => +p.acute.toFixed(2)), color: ACUTE, smooth: false, name: "Aguda", z: 2 }),
        {
          ...lineSeries({ data: pts.map((p) => +p.form.toFixed(2)), color: FORM, dashed: true, width: 1.5, smooth: false, name: "Forma", z: 1 }),
          yAxisIndex: 1,
          markLine: refLine({ value: 0, label: "forma 0", side: "end" }),
        },
      ],
    };
  }, [pts]);

  const selRuns = picked ? picked.runs.map((id) => view.runs[id]).filter(Boolean) : [];

  return (
    <section id="forma" className="card scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Carga y forma</div>
          {cur && (
            <p className="mt-2 text-[13px] text-fg-2">
              Ratio aguda/crónica{" "}
              <b className="num text-[18px] text-fg">{cur.ratio === null ? "—" : `${ap(cur.approx)}${fmtRatio(cur.ratio)}`}</b>
            </p>
          )}
        </div>
        <StatePill state={cur?.state ?? null} warmup={cur?.warmup} />
      </div>
      {view.openInjury && <p className="mt-2 text-[13px] font-semibold text-danger">Lesión abierta: la carga cuenta, pero prioriza recuperar.</p>}

      {cur && (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            ["Forma física", "crónica", cur.chronic, "var(--chart-line)", n1],
            ["Fatiga", "aguda", cur.acute, ACUTE, n1],
            ["Forma", "crónica − aguda", cur.form, FORM, signed],
          ].map(([title, sub, v, color, f]) => (
            <div key={title as string} className="rounded-2xl border border-line bg-inset px-3 py-2">
              <dt className="flex items-center gap-1.5 text-[11px] text-fg-2">
                <span className="h-2 w-2 rounded-full" style={{ background: color as string }} />
                {title as string}
              </dt>
              <dd className="num text-[20px]">
                {ap(cur.approx)}
                {(f as (x: number) => string)(v as number)}
              </dd>
              <dd className="text-[10px] text-fg-3">{sub as string}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4">
        <Segmented
          label="Periodo de carga y forma"
          value={range}
          onChange={(k) => {
            setRange(k as typeof range);
            setSel(null);
          }}
          items={RANGES.map((r) => ({ key: r.key, label: r.label }))}
        />
      </div>

      <div className="mt-3">
        {pts.length < 7 ? (
          <ChartEmpty height={200} message="Aún no hay carreras con carga para dibujar la forma." />
        ) : (
          <EChart option={option} height={210} label="Carga crónica, aguda y forma por día" onSelect={setSel} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2">
        {(Object.keys(STATE_LABEL) as LoadState[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `color-mix(in srgb, ${STATE_COLOR[s]} 35%, transparent)` }} />
            {STATE_LABEL[s]}
          </span>
        ))}
        <span>· Línea discontinua: forma (eje derecho).</span>
      </div>
      <p className="mt-2 rounded-xl border border-line bg-inset px-3 py-2 text-[12px] leading-snug text-fg-2">
        Con pocas carreras por semana el ratio oscila mucho; fíjate en la tendencia de la crónica.
      </p>

      {picked && (
        <div className="mt-3 rounded-2xl border border-line-strong bg-inset p-3.5" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold first-letter:uppercase">{dayLabel(picked.date, { weekday: "long", day: "numeric", month: "long" })}</div>
            <StatePill state={picked.state} />
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
            {[
              ["Carga del día", `${ap(picked.dayApprox)}${n0(picked.load)}`],
              ["Aguda", `${ap(picked.approx)}${n1(picked.acute)}`],
              ["Crónica", `${ap(picked.approx)}${n1(picked.chronic)}`],
              ["Forma", `${ap(picked.approx)}${signed(picked.form)}`],
              ["Ratio", picked.ratio === null ? "—" : `${ap(picked.approx)}${fmtRatio(picked.ratio)}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-fg-2">{k}</dt>
                <dd className="num text-[15px]">{v}</dd>
              </div>
            ))}
          </dl>
          {picked.missing > 0 && <p className="mt-2 text-[12px] text-fg-2">{picked.missing === 1 ? "Una carrera" : `${picked.missing} carreras`} sin pulso: su carga no cuenta.</p>}
          {selRuns.length ? (
            <ul className="mt-2 flex flex-col">
              {selRuns.map((r) => (
                <li key={r.id}>
                  <Link href={`/actividad/${r.id}`} className="flex min-h-[44px] items-center justify-between gap-2 border-t border-line text-[13px]">
                    <span className="flex items-center gap-2">
                      {r.type && isSessionType(r.type) ? (
                        <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[r.type].color }} />
                      ) : null}
                      {r.type && isSessionType(r.type) ? TYPE_META[r.type].label : "Carrera"}
                      {r.km !== null ? ` · ${r.km.toLocaleString("es-ES", { maximumFractionDigits: 1 })} km` : ""}
                    </span>
                    <span className="num">{r.load === null ? "sin dato" : `${r.estimated ? "≈" : ""}${n0(r.load)}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-fg-2">Sin carreras ese día.</p>
          )}
        </div>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-fg-2">
        Aguda: media de los últimos 7 días. Crónica: media ponderada de 28 días. Forma = crónica − aguda. Ratio: por debajo de{" "}
        {fmtRatio(RATIO_BANDS.rested)} descansado, hasta {fmtRatio(RATIO_BANDS.high)} en forma, hasta {fmtRatio(RATIO_BANDS.risk)} cargado y por encima,
        riesgo de sobrecarga. Los periodos de lesión cuentan (son carga real).
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-2">
        Carga de las carreras de los últimos 12 meses: <b className="text-fg">{c.measured}</b> medidas (pulso en ≥ 80 % de la carrera),{" "}
        <b className="text-fg">{c.estimated}</b> estimadas con el pulso medio (≈) y <b className="text-fg">{c.missing}</b> sin dato (sin pulso, no cuentan).
        {view.historyDays < 28 ? " Menos de 28 días de historial: cifras estimadas." : ""}
        {anyApprox ? " Las cifras con ≈ incluyen cargas estimadas en sus 28 días." : ""}
      </p>

      <WeeklyLoad view={view} days={days} />
    </section>
  );
}

/** Carga por semana frente a la media de las 8 anteriores. */
function WeeklyLoad({ view, days }: { view: FitnessView; days: number }) {
  const weeks = useMemo(() => view.weeks.slice(-Math.ceil(days / 7)), [view.weeks, days]);
  const [sel, setSel] = useState<number | null>(null);
  const last = weeks.at(-1);
  const option = useMemo(
    () => ({
      ...baseOption({ left: 34, right: 10, top: 12, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const w = weeks[ps[0]?.dataIndex ?? 0];
          if (!w) return "";
          return (
            tipHead(`Semana del ${dayLabel(w.start)}${w.partial ? " (en curso)" : ""}`) +
            tipRow(`${ap(w.approx)}${n0(w.load)}`, "Carga") +
            (w.avg8 !== null ? tipRow(n0(w.avg8), "Media 8 sem.", ACUTE) : "") +
            (w.vsAvg !== null && !w.partial ? tipRow(`${w.vsAvg > 0 ? "+" : ""}${Math.round(w.vsAvg * 100)} %`, "vs media") : "")
          );
        },
      }),
      xAxis: categoryAxis(
        weeks.map((w) => w.start),
        { every: Math.max(1, Math.round(weeks.length / 6)), format: (v) => dayLabel(v) },
      ),
      yAxis: valueAxis({ min: 0 }),
      series: [
        {
          ...barSeries({ data: weeks.map((w, i) => ({ value: Math.round(w.load), itemStyle: barItem({ current: w.partial, selected: sel === i }) })) }),
        },
        lineSeries({ data: weeks.map((w) => (w.avg8 === null ? null : Math.round(w.avg8))), color: ACUTE, dashed: true, width: 1.5, name: "Media 8 semanas" }),
      ],
      ...ANIMATION,
    }),
    [weeks, sel],
  );
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Carga semanal</div>
        {last && (
          <span className="text-[12px] text-fg-2">
            Esta semana <b className="num text-fg">{ap(last.approx)}{n0(last.load)}</b>
          </span>
        )}
      </div>
      {weeks.length < 2 ? (
        <ChartEmpty height={160} kind="bars" message="Aún no hay semanas suficientes." />
      ) : (
        <div className="mt-2">
          <EChart option={option} height={170} label="Carga por semana y media de las 8 anteriores" onSelect={setSel} />
        </div>
      )}
      <p className="mt-2 text-[12px] text-fg-2">
        Barras: carga de lunes a domingo (en lima, la semana en curso). Discontinua: media de las 8 semanas anteriores, la referencia con la que
        comparar cada semana.
      </p>
      {last && last.avg8 !== null && (
        <p className="mt-1 text-[12px] text-fg-2">
          Semana pasada:{" "}
          {(() => {
            const prev = weeks.at(-2);
            if (!prev || prev.vsAvg === null) return "sin media para comparar.";
            const pct = Math.round(prev.vsAvg * 100);
            return `${ap(prev.approx)}${n0(prev.load)}, ${pct === 0 ? "igual que" : `${Math.abs(pct)} % ${pct > 0 ? "por encima de" : "por debajo de"}`} la media de 8 semanas (${n0(prev.avg8!)}).`;
          })()}
        </p>
      )}
    </div>
  );
}

/** Tarjeta de Inicio: estado actual y mini gráfico de 28 días; abre el detalle en Análisis. */
export function FitnessMini({
  f,
}: {
  f: { state: LoadState | null; ratio: number | null; approx: boolean; warmup: boolean; openInjury: boolean; last28: { date: string; acute: number; chronic: number }[] };
}) {
  const option = useMemo(
    () => ({
      ...baseOption({ left: 0, right: 0, top: 4, bottom: 4 }),
      animationDuration: 500,
      xAxis: categoryAxis(f.last28.map((p) => p.date), { show: false }),
      yAxis: valueAxis({ show: false, min: 0 }),
      series: [lineSeries({ data: f.last28.map((p) => +p.chronic.toFixed(2)), area: true, smooth: false }), lineSeries({ data: f.last28.map((p) => +p.acute.toFixed(2)), color: ACUTE, width: 1.5, smooth: false })],
    }),
    [f.last28],
  );
  return (
    <Link href="/analisis#forma" className="card flex flex-col gap-2 p-5" aria-label={`Carga y forma: ${f.state ? STATE_LABEL[f.state] : "sin datos"}. Ver detalle`}>
      <div className="flex items-center justify-between">
        <div className="eyebrow">Carga y forma</div>
        <StatePill state={f.state} warmup={f.warmup} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-[13px] text-fg-2">
          Ratio{" "}
          <b className="num text-[22px] text-fg">{f.ratio === null ? "—" : `${ap(f.approx)}${fmtRatio(f.ratio)}`}</b>
          <div className="mt-0.5 text-[11px]">
            <span style={{ color: "var(--chart-line)" }}>━</span> crónica · <span style={{ color: ACUTE }}>━</span> aguda · 28 días
          </div>
        </div>
        <div className="h-[56px] w-[150px] flex-none">
          <EChart option={option} height={56} label="Carga aguda y crónica de los últimos 28 días" />
        </div>
      </div>
      {f.openInjury && <p className="text-[12px] font-semibold text-danger">Lesión abierta: prioriza recuperar.</p>}
    </Link>
  );
}
