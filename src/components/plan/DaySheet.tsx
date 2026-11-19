"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveMineAction, moveSuggestionAction } from "@/app/(app)/plan/session-actions";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { TYPE_META, isSessionType } from "@/lib/analysis/session-type";
import type { DayCell, DayPlan } from "@/lib/plan/calendar";
import { MINE_PAST_DAYS } from "@/lib/plan/mine";
import { SHIFT_META, dayNum, mondayOfDay, ymdOf, type ShiftKind } from "@/lib/plan/shifts";

const COLOR: Record<string, string> = {
  tirada_larga: "var(--t-tirada_larga)",
  calidad: "var(--t-series)",
  suave: "var(--t-rodaje)",
  otro: "var(--chart-line)",
};
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const btn = "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold";

/** Hoja del día: turno, sesiones previstas (editar, mover), carreras hechas y añadir. */
export function DaySheet({ ymd, cell, shift, today, onClose }: { ymd: string | null; cell?: DayCell; shift?: ShiftKind; today: string; onClose: () => void }) {
  if (!ymd) return null;
  const d = dayNum(ymd)!;
  const title = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
  const past = ymd < today;
  const canAddSession = d >= dayNum(today)! - MINE_PAST_DAYS;
  const plans = cell?.plans ?? [];
  const runs = cell?.runs ?? [];
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="first-letter:uppercase">{title}</span>
          {ymd === today && <span className="text-[13px] font-semibold text-lime-text">Hoy</span>}
        </span>
      }
    >
      <div className="flex flex-col gap-4" key={ymd}>
        {/* Turno */}
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          {shift ? (
            <>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SHIFT_META[shift].color }} aria-hidden="true" />
              <span>
                Semana de <b>{SHIFT_META[shift].label.toLowerCase()}</b>
                <span className="text-fg-2"> · desde el lunes {Number(ymdOf(mondayOfDay(d)).slice(8))}</span>
              </span>
            </>
          ) : (
            <span className="text-fg-2">Sin ciclo de turnos (se indica en Perfil).</span>
          )}
        </div>
        {cell?.race && (
          <div className="rounded-2xl px-3.5 py-2.5 text-[14px] font-semibold text-[var(--t-competicion)]" style={{ background: "color-mix(in srgb, var(--t-competicion) 14%, transparent)" }}>
            🏁 {cell.race}
          </div>
        )}
        {cell?.injury && <p className="text-[13px] text-danger">Día dentro de un periodo de lesión.</p>}

        {/* Previstas */}
        <section aria-label="Sesiones previstas">
          <div className="eyebrow">Previstas</div>
          {plans.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {plans.map((p, i) => (
                <PlanItem key={p.id ?? `s${i}`} p={p} day={ymd} onDone={onClose} />
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[14px] text-fg-2">Nada previsto.</p>
          )}
        </section>

        {/* Hechas */}
        {(runs.length > 0 || past || ymd === today) && (
          <section aria-label="Carreras hechas">
            <div className="eyebrow">Hechas</div>
            {runs.length ? (
              <ul className="mt-2 flex flex-col gap-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/actividad/${r.id}`} className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2 text-[14px]">
                      <span className="font-semibold text-[var(--load-low)]" aria-hidden="true">
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <b>{r.type && isSessionType(r.type) ? TYPE_META[r.type].label : "Carrera"}</b>
                        <span className="text-fg-2">
                          {r.km !== null ? ` · ${r.km.toLocaleString("es-ES")} km` : ""}
                          {r.paceS !== null ? ` · ${pace(r.paceS)} /km` : ""}
                        </span>
                      </span>
                      <span className="text-fg-3" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[14px] text-fg-2">Sin carreras ese día.</p>
            )}
          </section>
        )}

        {/* Añadir */}
        <div className="grid grid-cols-2 gap-2">
          {canAddSession ? (
            <Link href={`/plan/sesion/nueva?fecha=${ymd}`} className={`${btn} ${ymd > today ? "col-span-2" : ""} border border-line-strong`}>
              ＋ Añadir sesión
            </Link>
          ) : null}
          {ymd <= today && (
            <Link href={`/actividad/nueva?fecha=${ymd}`} className={`${btn} ${canAddSession ? "" : "col-span-2"} bg-lime text-lime-ink`}>
              ＋ Añadir carrera
            </Link>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

/** Una sesión prevista: mía o sugerida, con «Editar» y «Mover a…». */
function PlanItem({ p, day, onDone }: { p: DayPlan; day: string; onDone: () => void }) {
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState(day);
  const [pending, start] = useTransition();
  const edit = p.mine ? `/plan/sesion/${p.id}` : `/plan/sesion/nueva?semana=${p.week}`;
  const move = () =>
    start(async () => {
      try {
        const r = p.mine ? await moveMineAction(p.id!, to) : await moveSuggestionAction(p.week!, p.session!, to);
        if (r.ok) {
          if (r.message.includes("aviso")) toast.show("info", r.message);
          else toast.success(r.message);
          onDone();
        } else toast.error(r.message);
      } catch {
        toast.error("No se pudo mover. Inténtalo de nuevo.");
      }
    });
  return (
    <li className="rounded-2xl border border-line bg-inset px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: COLOR[p.kind], opacity: p.mine ? 1 : 0.4 }} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14px]">
          <b>{p.label}</b>
          {p.detail ? <span className="text-fg-2"> · {p.detail}</span> : null}
          {p.note && <span className="block truncate text-[12px] text-fg-2">{p.note}</span>}
        </span>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.mine ? "border border-lime/40 bg-lime/10 text-lime-text" : "border border-line-strong text-fg-2"}`}
        >
          {p.mine ? "Puesta por mí" : "Sugerida"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Link href={edit} className={`${btn} border border-line-strong`}>
          Editar
        </Link>
        <button type="button" aria-expanded={moving} onClick={() => setMoving((v) => !v)} className={`${btn} border border-line-strong`}>
          Mover a…
        </button>
      </div>
      {moving && (
        <div className="form-row mt-2 items-end">
          <label className="flex flex-col gap-1 text-[12px] text-fg-2">
            Nueva fecha
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-[var(--card)] px-3 text-[16px] text-fg outline-none focus:border-lime" />
          </label>
          <button type="button" disabled={pending || !to} onClick={move} className={`${btn} bg-lime text-lime-ink`}>
            {pending && <Spinner size={14} />}
            {pending ? "Moviendo…" : "Mover"}
          </button>
        </div>
      )}
      {!p.mine && <p className="mt-1.5 text-[11px] text-fg-3">Al editarla o moverla pasa a ser tuya y sustituye a la sugerencia de su semana.</p>}
    </li>
  );
}
