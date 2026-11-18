"use client";

import { useMemo } from "react";
import type { IntervalAnalysis, IntervalRow } from "@/lib/analysis/intervals";
import { regularAxis } from "@/lib/analysis/axis";
import { C, EChart } from "./EChart";
import { axisLabel, baseOption, barItem, barSeries, categoryAxis, refLine, tipHead, tipRow, tooltip, valueAxis } from "./theme";

const paceStr = (s: number | null | undefined) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const clock = (s: number) => {
  const t = Math.round(s);
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, "0")}`;
};
const dist = (m: number | null) => (m === null ? "—" : m >= 1000 ? `${(m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} km` : `${Math.round(m)} m`);
const n0 = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
const KIND: Record<IntervalRow["kind"], string> = {
  calentamiento: "Calentamiento",
  trabajo: "Trabajo",
  recuperacion: "Recuperación",
  enfriamiento: "Enfriamiento",
  otro: "Paso",
};

/** Series: resumen, barras con el ritmo de cada repetición y tabla con trabajo y recuperaciones. */
export function IntervalsCard({ analysis, sel, onSel }: { analysis: IntervalAnalysis; sel: string | null; onSel: (k: string | null) => void }) {
  const work = useMemo(() => (analysis.ok ? analysis.rows.filter((r) => r.kind === "trabajo") : []), [analysis]);

  const option = useMemo(() => {
    if (!analysis.ok) return null;
    const paces = work.map((w) => w.paceSPerKm).filter((p): p is number => p !== null);
    const ax = regularAxis([...paces, analysis.summary.workPaceSPerKm ?? paces[0]], 3);
    return {
      ...baseOption({ left: 44, right: 12, top: 18, bottom: 24 }),
      tooltip: tooltip({
        pointer: false,
        formatter: (ps: { dataIndex: number }[]) => {
          const w = work[ps[0].dataIndex];
          return tipHead(`Repetición ${w.rep}`) + tipRow(`${paceStr(w.paceSPerKm)} /km`, w.distanceM ? `${Math.round(w.distanceM)} m` : undefined);
        },
      }),
      xAxis: categoryAxis(work.map((w) => String(w.rep))),
      yAxis: valueAxis({ min: ax.min, max: ax.max, interval: ax.interval, format: (v) => paceStr(v) }),
      series: [
        {
          ...barSeries({
            data: work.map((w) => ({ value: w.paceSPerKm ?? "-", itemStyle: barItem({ current: sel === `step:${w.key}` }) })),
          }),
          label: { show: true, position: "top", color: axisLabel.color, fontFamily: C.font, fontSize: 10, formatter: (p: { value: number }) => paceStr(p.value) },
          markLine: analysis.summary.workPaceSPerKm ? refLine({ value: analysis.summary.workPaceSPerKm, label: `Media ${paceStr(analysis.summary.workPaceSPerKm)}`, side: "start" }) : undefined,
        },
      ],
    };
  }, [analysis, work, sel]);

  if (!analysis.ok) {
    return (
      <section className="card p-5">
        <div className="eyebrow">Series</div>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{analysis.reason}</p>
      </section>
    );
  }
  const s = analysis.summary;
  const drop = s.paceDropPct;

  return (
    <section className="card p-5" aria-label="Series">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Series · {s.reps} repeticiones</div>
        <span className="text-[11px] text-fg-2">Pasos del reloj</span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Ritmo de trabajo" value={paceStr(s.workPaceSPerKm)} unit="/km" />
        <Stat
          label="1.ª → última"
          value={drop === null ? "—" : `${drop > 0 ? "+" : drop < 0 ? "−" : ""}${Math.abs(drop).toFixed(1).replace(".", ",")} %`}
          note={drop === null ? undefined : Math.abs(drop) < 0.5 ? "igual" : drop > 0 ? "más lenta" : "más rápida"}
        />
        <Stat label="Recuperación FC" value={s.avgHrDrop === null ? "—" : `−${Math.round(s.avgHrDrop)}`} unit={s.avgHrDrop === null ? undefined : "ppm"} note={s.avgHrDrop === null ? "sin pulso" : "media por pausa"} />
      </dl>

      {option && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between px-1">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-2 uppercase">Ritmo por repetición</span>
            <span className="text-[11px] text-fg-2">barra más corta = más rápida</span>
          </div>
          <EChart
            option={option}
            height={170}
            label="Ritmo de cada repetición"
            onSelect={(i) => {
              const k = work[i] && `step:${work[i].key}`;
              if (k) onSel(sel === k ? null : k);
            }}
          />
        </div>
      )}

      <div className="mt-3 grid grid-cols-[34px_1fr_44px_40px_52px] items-center gap-x-2 px-1 text-[10px] font-semibold tracking-[0.06em] text-fg-2 uppercase">
        <span>Nº</span>
        <span>Distancia · tiempo</span>
        <span>Ritmo</span>
        <span className="text-right">FC</span>
        <span className="text-right">Máx</span>
      </div>
      <ol className="mt-1">
        {analysis.rows.map((r) => {
          const k = `step:${r.key}`;
          const active = sel === k;
          const isWork = r.kind === "trabajo";
          const isRec = r.kind === "recuperacion";
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onSel(active ? null : k)}
                aria-pressed={active}
                aria-label={`${KIND[r.kind]}${r.rep ? ` ${r.rep}` : ""}`}
                className={`grid min-h-[40px] w-full grid-cols-[34px_1fr_44px_40px_52px] items-center gap-x-2 rounded-xl px-1 text-left ${
                  active ? "bg-ov-2 ring-1 ring-[var(--line-strong)]" : ""
                } ${isWork ? "" : "text-fg-2"}`}
              >
                <span className={`num text-[13px] ${isWork ? "font-bold" : ""}`}>{isWork ? r.rep : ""}</span>
                <span className="min-w-0">
                  <span className={`block text-[11px] ${isWork ? "text-lime-text font-semibold" : "text-fg-2"}`}>
                    {isRec ? `↳ ${KIND[r.kind]}` : KIND[r.kind]}
                  </span>
                  <span className="num block text-[13px]">
                    {dist(r.distanceM)} · {clock(r.durationS)}
                  </span>
                </span>
                <span className={`num text-[14px] ${isWork ? "" : "text-fg-2"}`}>{paceStr(r.paceSPerKm)}</span>
                <span className="num text-right text-[13px]">{n0(r.avgHr)}</span>
                <span className="num text-right text-[12px]">
                  {isRec ? (r.hrDrop === null ? "—" : `−${Math.round(r.hrDrop)}`) : n0(r.maxHr)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-2">
        Toca una repetición para verla en el mapa y los gráficos. En las recuperaciones, la última columna es cuánto bajó el pulso desde el final de
        la repetición anterior. Trabajo = fase 0 de cada repetición y recuperación = fase 1, comprobado con el ritmo.
      </p>
    </section>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-inset p-3">
      <dt className="text-[11px] text-fg-2">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className={`num text-[20px] ${value === "—" ? "text-fg-3" : ""}`}>{value}</span>
        {unit && <span className="text-[10px] text-fg-2">{unit}</span>}
      </dd>
      {note && <div className="mt-0.5 text-[11px] text-fg-2">{note}</div>}
    </div>
  );
}
