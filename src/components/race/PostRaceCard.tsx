"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { EChart } from "@/components/charts/EChart";
import { baseOption, barItem, barSeries, categoryAxis, tipHead, tipRow, tooltip, valueAxis } from "@/components/charts/theme";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { linkRaceAction, unlinkRaceAction } from "@/app/(app)/plan/race-actions";
import { compareRace, type ActualSplit } from "@/lib/race/postrace";
import { pacePlan, type Strategy } from "@/lib/race/pacing";
import { fmtTime, type RaceProfile } from "@/lib/race/race";
import { TYPE_META, isSessionType } from "@/lib/analysis/session-type";

const signed = (s: number) => `${s > 0 ? "+" : s < 0 ? "−" : ""}${fmtTime(Math.abs(s))}`;

interface Props {
  raceId: string;
  date: string;
  distanceM: number;
  targetS: number;
  strategy: Strategy;
  profile: RaceProfile | null;
  actual: { runId: string; durationS: number; distanceM: number | null; type: string | null; splits: ActualSplit[] } | null;
  candidates: { id: string; distanceM: number | null; durationS: number; type: string | null; startAt: string }[];
}

/** Después de la carrera: vincular la carrera real y comparar con el plan. */
export function PostRaceCard(p: Props) {
  const [pending, start] = useTransition();
  const [mark, setMark] = useState(true);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      } catch {
        toast.error("No se pudo completar. Inténtalo de nuevo.");
      }
    });

  const cmp = useMemo(() => {
    if (!p.actual) return null;
    const plan = pacePlan({ distanceM: p.distanceM, targetS: p.targetS, strategy: p.strategy, profile: p.profile });
    return compareRace(plan, p.actual.splits, { distanceM: p.distanceM, realTotalS: p.actual.durationS });
  }, [p.actual, p.distanceM, p.targetS, p.strategy, p.profile]);

  const option = useMemo(() => {
    if (!cmp) return null;
    const rows = cmp.rows.filter((r) => r.cumDiffS !== null);
    if (!rows.length) return null;
    return {
      ...baseOption({ left: 44, right: 10, top: 12, bottom: 22 }),
      tooltip: tooltip({
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0]?.dataIndex ?? 0];
          if (!r) return "";
          return tipHead(`Km ${r.km}`) + tipRow(signed(r.cumDiffS!), r.cumDiffS! <= 0 ? "Adelantado" : "Atrasado") + (r.diffS !== null ? tipRow(signed(r.diffS), "Este km") : "");
        },
      }),
      xAxis: categoryAxis(rows.map((r) => String(r.km)), { every: Math.max(1, Math.round(rows.length / 8)) }),
      yAxis: valueAxis({ format: (v: number) => signed(v) }),
      series: [
        {
          ...barSeries({
            data: rows.map((r) => ({ value: r.cumDiffS, itemStyle: barItem({ color: r.cumDiffS! <= 0 ? "var(--load-low)" : "var(--load-high)" }) })),
          }),
        },
      ],
    };
  }, [cmp]);

  if (!p.actual) {
    return (
      <section className="card p-5" aria-label="Después de la carrera">
        <div className="eyebrow">Después de la carrera</div>
        {p.candidates.length ? (
          <>
            <p className="mt-2 text-[13px] text-fg-2">¿Cuál de tus carreras de ese día es esta? Al vincularla verás los parciales reales frente al plan.</p>
            <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[14px]">
              <input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} className="h-5 w-5 accent-[var(--lime)]" />
              Marcarla como Competición
            </label>
            <ul className="mt-1 flex flex-col gap-2">
              {p.candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2.5">
                  <span className="text-[14px]">
                    <b className="num">{c.distanceM === null ? "—" : (c.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} km</b> · {fmtTime(c.durationS)}
                    <span className="block text-[12px] text-fg-2">
                      {new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(c.startAt))}
                      {c.type && isSessionType(c.type) ? ` · ${TYPE_META[c.type].label}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => linkRaceAction(p.raceId, c.id, mark))}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl bg-lime px-4 text-[14px] font-semibold text-lime-ink"
                  >
                    {pending && <Spinner size={14} />}
                    Vincular
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-[14px] text-fg-2">No hay ninguna carrera tuya ese día en Actividad. Cuando la importes o la añadas, podrás vincularla aquí.</p>
        )}
      </section>
    );
  }

  const c = cmp!;
  return (
    <section className="card p-5" aria-label="Después de la carrera">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">Después de la carrera</div>
        <Link href={`/actividad/${p.actual.runId}`} className="-my-3 -mr-2 inline-flex min-h-[44px] items-center px-2 text-[12px] text-fg-2">
          Ver la carrera ›
        </Link>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-[14px] leading-snug">
        {c.summary.map((s, i) => (
          <li key={i} className={i === 0 ? "font-semibold" : ""}>
            {s}
          </li>
        ))}
      </ul>
      {option && (
        <>
          <div className="mt-4 eyebrow">Diferencia acumulada con el plan</div>
          <div className="mt-2">
            <EChart option={option} height={170} label="Diferencia acumulada con el plan por km" />
          </div>
          <p className="mt-1 text-[11px] text-fg-2">Verde: por delante del plan. Rojo: por detrás.</p>
        </>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
        {(["Primera mitad", "Segunda mitad"] as const).map((t, i) => (
          <div key={t} className="rounded-2xl border border-line bg-inset p-3">
            <div className="text-[12px] text-fg-2">{t}</div>
            <div className="num text-[20px]">{c.halvesReal ? fmtTime(c.halvesReal[i]) : "—"}</div>
            <div className="text-[12px] text-fg-2">plan {fmtTime(c.halvesPlan[i])}</div>
          </div>
        ))}
      </div>
      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="text-[11px] tracking-[0.06em] text-fg-2 uppercase">
            <th scope="col" className="py-1.5 text-left font-semibold">Km</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Plan</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Real</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Dif.</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Acum.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {c.rows.map((r) => (
            <tr key={r.km}>
              <td className="py-1.5">{r.km}</td>
              <td className="py-1.5 text-right text-fg-2">{fmtTime(r.planS)}</td>
              <td className="num py-1.5 text-right text-[14px]">{r.realS === null ? "—" : fmtTime(r.realS)}</td>
              <td className={`py-1.5 text-right ${r.diffS !== null && r.diffS > 0 ? "text-danger" : "text-lime-text"}`}>{r.diffS === null ? "—" : signed(r.diffS)}</td>
              <td className="py-1.5 text-right text-fg-2">{r.cumDiffS === null ? "—" : signed(r.cumDiffS)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={pending} onClick={() => run(() => unlinkRaceAction(p.raceId))} className="mt-3 min-h-[44px] w-full rounded-xl text-[14px] font-semibold text-fg-2">
        Quitar el vínculo
      </button>
    </section>
  );
}
