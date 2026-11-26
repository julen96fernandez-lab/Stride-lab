"use client";

import { useMemo, useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { baseOption, barSeries, categoryAxis, refLine, tipHead, tipRow, tooltip, valueAxis } from "@/components/charts/theme";
import { Segmented } from "@/components/ui/Segmented";
import { INTENSITY_RULES, INTENSITY_VIEWS, type IntensityResult, type IntensityView } from "@/lib/analysis/intensity";

const COLOR = { easy: "var(--z2)", mid: "var(--z3)", hard: "var(--z5)" } as const;
const LABEL = { easy: "Suave (Z1–Z2)", mid: "Medio (Z3)", hard: "Fuerte (Z4–Z5)" } as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")} min` : `${Math.round(s / 60)} min`);

/**
 * «Intensidad»: reparto del tiempo por zonas (suave, medio, fuerte) en barras apiladas al 100 %,
 * con la línea neutra del 80 % suave. Las tres vistas llegan calculadas: el selector es instantáneo.
 */
export function IntensityCard({ data }: { data: Record<IntensityView, IntensityResult> }) {
  const [view, setView] = useState<IntensityView>("12s");
  const r = data[view];
  const option = useMemo(() => {
    const share = (b: (typeof r.buckets)[number], k: "easyS" | "midS" | "hardS") => {
      const t = b.easyS + b.midS + b.hardS;
      return t > 0 ? Math.round((b[k] / t) * 1000) / 10 : null;
    };
    return {
      ...baseOption({ left: 36, right: 10, top: 14, bottom: 24 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const b = r.buckets[ps[0]?.dataIndex ?? 0];
          if (!b) return "";
          const t = b.easyS + b.midS + b.hardS;
          if (!t) return tipHead(b.label) + tipRow("sin carreras con pulso suficiente");
          return (
            tipHead(`${b.label} · ${b.runs === 1 ? "1 carrera" : `${b.runs} carreras`}`) +
            tipRow(`${pct(b.easyS / t)} · ${mins(b.easyS)}`, "Suave", COLOR.easy) +
            tipRow(`${pct(b.midS / t)} · ${mins(b.midS)}`, "Medio", COLOR.mid) +
            tipRow(`${pct(b.hardS / t)} · ${mins(b.hardS)}`, "Fuerte", COLOR.hard)
          );
        },
      }),
      xAxis: categoryAxis(r.buckets.map((b) => b.label), { every: Math.max(1, Math.ceil(r.buckets.length / 6)) }),
      yAxis: valueAxis({ min: 0, max: 100, interval: 20, format: (v: number) => `${v} %` }),
      series: [
        {
          ...barSeries({ data: r.buckets.map((b) => share(b, "easyS")), stack: "z", name: "Suave", maxWidth: 26 }),
          itemStyle: { color: COLOR.easy },
          markLine: refLine({ value: INTENSITY_RULES.easyGuide * 100, label: "80 % suave", side: "start" }),
        },
        { ...barSeries({ data: r.buckets.map((b) => share(b, "midS")), stack: "z", name: "Medio", maxWidth: 26 }), itemStyle: { color: COLOR.mid } },
        { ...barSeries({ data: r.buckets.map((b) => share(b, "hardS")), stack: "z", name: "Fuerte", maxWidth: 26 }), itemStyle: { color: COLOR.hard, borderRadius: [5, 5, 0, 0] } },
      ],
    };
  }, [r]);

  return (
    <section id="intensidad" className="card scroll-mt-6 p-5" aria-label="Intensidad">
      <div className="eyebrow">Intensidad</div>
      <p className="mt-1 text-[12px] text-fg-2">Reparto del tiempo por zonas de pulso (las tuyas de Perfil).</p>
      <div className="mt-3">
        <Segmented label="Periodo" value={view} onChange={(k) => setView(k as IntensityView)} items={INTENSITY_VIEWS} stretch />
      </div>
      <div className="mt-3">
        <EChart option={option} height={190} label={`Reparto de intensidad por ${view === "12s" ? "semana" : "mes"}`} />
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2" aria-label="Leyenda">
        {(["easy", "mid", "hard"] as const).map((k) => (
          <li key={k} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: COLOR[k] }} aria-hidden="true" />
            {LABEL[k]}
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <span className="w-3 border-t border-dashed border-fg-3" aria-hidden="true" />
          80 % suave: guía habitual en corredores
        </li>
      </ul>

      {/* Totales del periodo */}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {(["easy", "mid", "hard"] as const).map((k) => (
          <div key={k} className="rounded-2xl border border-line bg-inset p-3">
            <dt className="text-[11px] text-fg-2">{LABEL[k].split(" ")[0]}</dt>
            <dd className={`num mt-1 text-[22px] ${r.sentence ? "" : "text-fg-2"}`} style={{ color: r.pct && r.sentence ? COLOR[k] : undefined }}>
              {r.pct ? pct(r.pct[k]) : "—"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[14px] leading-snug">
        {r.sentence ?? `Con menos de ${INTENSITY_RULES.minRuns} carreras con pulso suficiente en este periodo no se sacan conclusiones.`}
      </p>
      <p className="mt-1 text-[12px] text-fg-2">
        {r.valid === 1 ? "Entra 1 carrera" : `Entran ${r.valid} carreras`}
        {r.excluded ? `; ${r.excluded === 1 ? "1 se deja fuera" : `${r.excluded} se dejan fuera`} por pulso insuficiente (menos del 80 % de la carrera con pulso)` : ""}.
      </p>
    </section>
  );
}
