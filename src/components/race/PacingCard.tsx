"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { EChart } from "@/components/charts/EChart";
import { T, alpha, baseOption, categoryAxis, lineSeries, tipHead, tipRow, tooltip, valueAxis } from "@/components/charts/theme";
import { Segmented } from "@/components/ui/Segmented";
import { toast } from "@/components/ui/Toaster";
import { setRaceStrategyAction } from "@/app/(app)/plan/race-actions";
import { STRATEGIES, pacePlan, type Strategy } from "@/lib/race/pacing";
import { fmtTime, type RaceProfile } from "@/lib/race/race";

const pace = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Estrategia de ritmos: tabla por km, gráfico y aviso. El cambio de estrategia es instantáneo. */
export function PacingCard({
  raceId,
  distanceM,
  targetS,
  startTime,
  profile,
  initial,
}: {
  raceId: string;
  distanceM: number;
  targetS: number;
  startTime: string | null;
  profile: RaceProfile | null;
  initial: Strategy;
}) {
  const [strategy, setStrategy] = useState<Strategy>(initial);
  const [, start] = useTransition();
  const rows = useMemo(() => pacePlan({ distanceM, targetS, strategy, profile, startTime }), [distanceM, targetS, strategy, profile, startTime]);
  const eleByKm = useMemo(() => {
    if (!profile) return null;
    return rows.map((r) => {
      const a = (r.km - 1) * 1000;
      const pts = profile.e.filter((_, i) => profile.d[i] >= a && profile.d[i] <= a + r.lengthM);
      return pts.length ? Math.round(pts.reduce((x, y) => x + y, 0) / pts.length) : null;
    });
  }, [rows, profile]);

  const option = useMemo(() => {
    const paces = rows.map((r) => Math.round(r.paceS));
    const lo = Math.min(...paces);
    const hi = Math.max(...paces);
    // Marcas redondas (cada 10, 15, 30 o 60 s) y como mucho 5.
    const step = [10, 15, 30, 60].find((x) => (hi - lo + 10) / x <= 4) ?? 120;
    const yMin = Math.floor((lo - 3) / step) * step;
    const yMax = Math.ceil((hi + 3) / step) * step;
    return {
      ...baseOption({ left: 38, right: eleByKm ? 34 : 10, top: 12, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0]?.dataIndex ?? 0];
          if (!r) return "";
          return (
            tipHead(`Km ${r.km}${r.lengthM < 1000 ? ` (${r.lengthM} m)` : ""}`) +
            tipRow(`${pace(r.paceS)} /km`, "Ritmo") +
            tipRow(fmtTime(r.cumS), "Acumulado") +
            (r.grade !== null ? tipRow(`${(r.grade * 100).toFixed(1).replace(".", ",")} %`, "Pendiente") : "")
          );
        },
      }),
      xAxis: categoryAxis(rows.map((r) => String(r.km)), { every: Math.max(1, Math.round(rows.length / 8)) }),
      yAxis: [
        valueAxis({ min: yMin, max: yMax, interval: step, inverse: true, format: (v: number) => pace(v) }),
        ...(eleByKm ? [{ ...valueAxis({ format: (v: number) => `${Math.round(v)}` }), splitLine: { show: false } }] : []),
      ],
      series: [
        ...(eleByKm
          ? [{ type: "bar", data: eleByKm, yAxisIndex: 1, barCategoryGap: "8%", itemStyle: { color: alpha(T.muted, 0.18), borderRadius: [4, 4, 0, 0] }, silent: true, z: 1 }]
          : []),
        { ...lineSeries({ data: paces, points: rows.length <= 25, smooth: false, name: "Ritmo" }), z: 3 },
      ],
    };
  }, [rows, eleByKm]);

  return (
    <section className="card p-5" aria-label="Estrategia de ritmos">
      <div className="eyebrow">Estrategia de ritmos</div>
      <div className="mt-3">
        <Segmented
          variant="chips"
          label="Estrategia"
          value={strategy}
          onChange={(k) => {
            setStrategy(k as Strategy);
            start(async () => {
              const r = await setRaceStrategyAction(raceId, k).catch(() => ({ ok: false }));
              if (!r.ok) toast.error("No se pudo guardar la estrategia.");
            });
          }}
          items={STRATEGIES.map((s) => ({ key: s.key, label: s.label }))}
        />
      </div>
      <p className="mt-2 text-[13px] text-fg-2">
        {STRATEGIES.find((s) => s.key === strategy)!.hint}
        {profile ? " Ajustado km a km por la pendiente del recorrido (mismo esfuerzo), manteniendo el tiempo total." : ""}
      </p>
      <div className="mt-3">
        <EChart option={option} height={190} label="Ritmo previsto por km" />
      </div>
      <p className="mt-1 text-[11px] text-fg-2">Línea: ritmo por km (más arriba, más rápido).{profile ? " Barras grises: altitud media del km (eje derecho)." : ""}</p>

      <p className="mt-3 rounded-xl border border-line-strong bg-inset px-3 py-2 text-[12px] leading-snug">
        <b>Es una guía, no una garantía.</b> Escucha a tu cuerpo el día de la carrera: el calor, el viento o cómo hayas dormido cambian lo que es posible.
      </p>

      <Link href={`/plan/carrera/${raceId}/dia`} className="mt-3 flex min-h-[48px] items-center justify-center rounded-2xl bg-lime text-[15px] font-semibold text-lime-ink">
        Día de carrera: banda de ritmos
      </Link>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] tracking-[0.06em] text-fg-2 uppercase">
              <th scope="col" className="py-1.5 text-left font-semibold">Km</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Ritmo</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Parcial</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Acum.</th>
              {startTime && <th scope="col" className="py-1.5 text-right font-semibold">Hora</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.km}>
                <td className="py-1.5">
                  {r.km}
                  {r.lengthM < 1000 && <span className="text-fg-3"> ({r.lengthM} m)</span>}
                  {r.grade !== null && Math.abs(r.grade) >= 0.01 && (
                    <span className="ml-1 text-[11px] text-fg-2">
                      {r.grade > 0 ? "↗" : "↘"}
                      {Math.abs(r.grade * 100).toFixed(0)} %
                    </span>
                  )}
                </td>
                <td className="num py-1.5 text-right text-[14px]">{pace(r.paceS)}</td>
                <td className="py-1.5 text-right text-fg-2">{fmtTime(r.splitS)}</td>
                <td className="num py-1.5 text-right text-[14px]">{fmtTime(r.cumS)}</td>
                {startTime && <td className="py-1.5 text-right text-fg-2">{r.clock}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
