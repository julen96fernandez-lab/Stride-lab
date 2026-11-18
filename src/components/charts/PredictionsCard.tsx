"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EChart } from "./EChart";
import { ChartEmpty } from "./ChartEmpty";
import { T, alpha, baseOption, categoryAxis, lineSeries, tipHead, tipRow, tooltip, valueAxis } from "./theme";
import { Segmented } from "@/components/ui/Segmented";
import { SOURCE_LABEL, fmtRaceTime, type Confidence, type Prediction, type PredictionPoint, type TargetKey } from "@/lib/plan/predict";

const CONF: Record<Confidence, { label: string; color: string; text: string }> = {
  alta: { label: "Confianza alta", color: "var(--load-low)", text: "varios esfuerzos de los últimos 3 meses, de distancia parecida" },
  media: { label: "Confianza media", color: "var(--load-mod)", text: "algún esfuerzo de los últimos 6 meses a distancia parecida" },
  baja: { label: "Confianza baja", color: "var(--load-high)", text: "datos antiguos o de distancias lejanas" },
};

const ago = (days: number) => (days < 1 ? "hoy" : days < 14 ? `hace ${days} d` : days < 60 ? `hace ${Math.round(days / 7)} sem.` : `hace ${Math.round(days / 30)} meses`);
const monthLabel = (m: string) => new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "short", year: "2-digit" }).format(new Date(`${m}-01T00:00:00Z`));

/** Predicción de marcas: hoy (con rango, confianza y fuentes) y su evolución por meses. */
export function PredictionsCard({ now, history, longestM }: { now: Prediction[]; history: Record<TargetKey, PredictionPoint[]>; longestM: number }) {
  const [key, setKey] = useState<TargetKey | null>(now.find((p) => p.key === "10k")?.key ?? now[0]?.key ?? null);
  const p = now.find((x) => x.key === key) ?? null;
  const hist = useMemo(() => (key ? history[key] : []), [history, key]);
  const option = useMemo(() => {
    // Todos los meses (los que no tienen estimación quedan como hueco, sin juntar fechas lejanas).
    const months: string[] = [];
    if (hist.length) {
      const [y0, m0] = hist[0].month.split("-").map(Number);
      const [y1, m1] = hist[hist.length - 1].month.split("-").map(Number);
      for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    const by = new Map(hist.map((h) => [h.month, h]));
    const col = (f: (h: PredictionPoint) => number) => months.map((m) => (by.has(m) ? Math.round(f(by.get(m)!)) : null));
    const vals = hist.flatMap((h) => [h.lowS, h.highS]);
    const [min, max, interval] = timeAxisRange(Math.min(...vals), Math.max(...vals));
    return {
      ...baseOption({ left: 48, right: 10, top: 12, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const h = by.get(months[ps[0]?.dataIndex ?? 0]);
          if (!h) return tipHead(monthLabel(months[ps[0]?.dataIndex ?? 0])) + tipRow("—", "Sin esfuerzos recientes");
          return tipHead(monthLabel(h.month)) + tipRow(fmtRaceTime(h.timeS), "Estimación") + tipRow(`${fmtRaceTime(h.lowS)} – ${fmtRaceTime(h.highS)}`, "Rango") + tipRow(h.confidence, "Confianza");
        },
      }),
      xAxis: categoryAxis(months, { every: Math.max(1, Math.round(months.length / 5)), format: monthLabel }),
      // Hacia arriba = más rápido, como el resto de gráficos de ritmo.
      yAxis: valueAxis({ min, max, interval, inverse: true, format: (v: number) => fmtRaceTime(v) }),
      series: [
        { type: "line", data: col((h) => h.lowS), stack: "rango", symbol: "none", lineStyle: { opacity: 0 }, silent: true, z: 1 },
        { type: "line", data: col((h) => h.highS - h.lowS), stack: "rango", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: alpha(T.accent, 0.16) }, silent: true, z: 1 },
        lineSeries({ data: col((h) => h.timeS), points: hist.length < 12, smooth: false, name: "Estimación", z: 3 }),
      ],
    };
  }, [hist]);

  return (
    <section id="marcas" className="card scroll-mt-6 p-5" aria-label="Predicción de marcas">
      <div className="eyebrow">Predicción de marcas</div>
      <p className="mt-2 rounded-xl border border-line-strong bg-inset px-3 py-2 text-[12px] leading-snug">
        <b>Es una estimación, no una garantía.</b> Sale de tus mejores tramos en entrenamientos de los últimos 3 a 12 meses (no de carreras a tope) con
        la fórmula de Riegel; en una carrera real podrías ir más rápido. El rango refleja la incertidumbre.
      </p>
      {!now.length ? (
        <p className="mt-4 text-[14px] text-fg-2">Aún no hay esfuerzos recientes suficientes para estimar ninguna distancia.</p>
      ) : (
        <>
          <div className="mt-4">
            <Segmented
              stretch
              label="Distancia"
              value={key}
              onChange={(k) => setKey(k as TargetKey)}
              items={now.map((x) => ({ key: x.key, label: x.key === "half" ? "Media" : x.label.replace(" km", "K").replace(" ", "") }))}
            />
          </div>
          {p && (
            <div className="mt-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[12px] text-fg-2">{p.label}</div>
                  <div className="num text-[40px]">≈{fmtRaceTime(p.timeS)}</div>
                  <div className="mt-1 text-[13px] text-fg-2">
                    entre <b className="text-fg">{fmtRaceTime(p.lowS)}</b> y <b className="text-fg">{fmtRaceTime(p.highS)}</b>
                  </div>
                </div>
                <span
                  className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
                  style={{ color: CONF[p.confidence].color, background: `color-mix(in srgb, ${CONF[p.confidence].color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${CONF[p.confidence].color} 40%, transparent)` }}
                >
                  {CONF[p.confidence].label}
                </span>
              </div>
              <p className="mt-2 text-[12px] text-fg-2">Confianza {p.confidence}: {CONF[p.confidence].text}.</p>
              <ul className="mt-2 flex flex-col">
                {p.sources.map((s) => (
                  <li key={s.key}>
                    <Link href={s.runId ? `/actividad/${s.runId}` : "#"} className="flex min-h-[44px] items-center justify-between gap-2 border-t border-line text-[13px]">
                      <span>
                        Mejor {SOURCE_LABEL[s.key]}: <b className="num">{fmtRaceTime(s.timeS)}</b> <span className="text-fg-2">({ago(s.ageDays)})</span>
                      </span>
                      <span className="text-fg-2">→ {fmtRaceTime(s.estimateS)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-4 eyebrow">Evolución · 24 meses</div>
              <div className="mt-2">
                {hist.length < 2 ? (
                  <ChartEmpty height={170} message="Aún no hay meses suficientes para ver la evolución." />
                ) : (
                  <EChart option={option} height={180} label={`Evolución de la predicción de ${p.label}`} />
                )}
              </div>
              <p className="mt-2 text-[12px] text-fg-2">
                Cada mes, la estimación con los datos que había entonces; la banda es el rango. Meses sin esfuerzos recientes válidos quedan fuera.
              </p>
            </div>
          )}
        </>
      )}
      {!now.some((x) => x.key === "marathon") && (
        <p className="mt-3 text-[12px] text-fg-2">
          Maratón: oculto hasta que tengas una tirada de 30 km o más en los últimos 12 meses (la más larga: {(longestM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km).
        </p>
      )}
    </section>
  );
}

/** Eje de tiempos con pasos redondos (30 s, 1, 2, 5, 10, 15 o 30 min) y como mucho 5 marcas. */
export function timeAxisRange(lo: number, hi: number): [number, number, number] {
  const steps = [30, 60, 120, 300, 600, 900, 1800];
  const span = Math.max(1, hi - lo);
  const step = steps.find((s) => span / s <= 4) ?? 3600;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
}
