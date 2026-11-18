"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { useActionToast } from "@/components/ui/Toaster";
import { useActionState, useState } from "react";
import { saveGoalsAction, type GoalsState } from "@/app/(app)/actividad/actions";
import type { Goals } from "@/lib/analysis/periods";

const field =
  "h-11 w-[96px] rounded-xl border border-line-strong bg-inset px-3 text-right text-[16px] text-fg outline-none focus:border-lime";

const ROWS = [
  { k: "week", label: "Por semana", hint: "media semanal" },
  { k: "month", label: "Por mes", hint: "media mensual" },
  { k: "year", label: "Por año", hint: "total de 12 meses" },
] as const;

/** Objetivos de km: cada uno opcional (vacío = sin objetivo) y se puede pausar. */
export function GoalsForm({ goals, suggested }: { goals: Goals; suggested: { week: number; month: number; year: number } }) {
  const [state, action] = useActionState<GoalsState, FormData>(saveGoalsAction, {});
  useActionToast(state);
  const [vals, setVals] = useState({
    week: goals.week.km?.toString().replace(".", ",") ?? "",
    month: goals.month.km?.toString().replace(".", ",") ?? "",
    year: goals.year.km?.toString().replace(".", ",") ?? "",
  });
  return (
    <form id="objetivos" action={action} className="card scroll-mt-6 flex flex-col gap-4 p-5">
      <div>
        <div className="eyebrow">Objetivos de kilómetros</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Opcionales. Déjalo vacío para no tener objetivo, o pausa uno sin borrarlo. Las sugerencias salen de tus últimos 12 meses.
        </p>
      </div>
      {ROWS.map(({ k, label, hint }) => (
        <div key={k} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${k}Km`} className="text-[14px] font-semibold">
              {label}
            </label>
            <span className="flex items-center gap-2">
              <input
                id={`${k}Km`}
                name={`${k}Km`}
                inputMode="decimal"
                placeholder="—"
                value={vals[k]}
                onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
                className={field}
              />
              <span className="w-[22px] text-fg-2">km</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[12px] text-fg-2">
            <button
              type="button"
              onClick={() => setVals((v) => ({ ...v, [k]: String(suggested[k]) }))}
              className="min-h-[44px] text-left underline-offset-2 hover:underline"
            >
              Sugerido: <b className="text-fg">{suggested[k]} km</b> ({hint}) · usar
            </button>
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="checkbox" name={`${k}Paused`} defaultChecked={goals[k].paused} className="h-4 w-4 accent-[var(--lime)]" />
              Pausar
            </label>
          </div>
        </div>
      ))}
      {state.error && (
        <p role="alert" className="text-[14px] text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton state={state} pending="Guardando…">
        Guardar objetivos
      </SubmitButton>
    </form>
  );
}
