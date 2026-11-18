"use client";

import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useActionToast } from "@/components/ui/Toaster";
import { saveShiftAnchorAction, type ShiftState } from "@/app/(app)/actividad/actions";
import { CYCLE, SHIFT_META, isMonday, shiftWeek } from "@/lib/plan/shifts";

const field = "h-11 rounded-xl border border-line-strong bg-inset px-3 text-[16px] text-fg outline-none focus:border-lime";

/** Inicio de un bloque de tardes: con él la app calcula el ciclo de 5 semanas. */
export function ShiftForm({ anchor, today }: { anchor: string | null; today: string }) {
  const [state, action] = useActionState<ShiftState, FormData>(saveShiftAnchorAction, {});
  useActionToast(state);
  const [v, setV] = useState(anchor ?? "");
  const ok = isMonday(v);
  const now = useMemo(() => (ok ? shiftWeek(v, today) : null), [ok, v, today]);
  return (
    <form id="turnos" action={action} className="card scroll-mt-6 flex flex-col gap-4 p-5">
      <div>
        <div className="eyebrow">Ciclo de turnos</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Bloques de una semana (lunes a domingo) en este orden: {CYCLE.map((k) => SHIFT_META[k].label.toLowerCase()).join(" → ")}, y vuelta a
          empezar. Indica el lunes en que empieza cualquier bloque de tardes.
        </p>
      </div>
      <label className="flex items-center justify-between gap-3 text-[14px]">
        <span>Inicio de un bloque de tardes</span>
        <input type="date" name="shiftAnchor" value={v} onChange={(e) => setV(e.target.value)} className={field} required />
      </label>
      {v && !ok && (
        <p role="alert" className="text-[13px] text-danger">
          Tiene que ser un lunes.
        </p>
      )}
      {now && (
        <p className="text-[13px] text-fg-2">
          Con esta fecha, esta semana es de <b className="text-fg">{SHIFT_META[now.kind].label.toLowerCase()}</b>.
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-[14px] text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton state={state} pending="Guardando…" disabled={!ok}>
        Guardar ciclo
      </SubmitButton>
    </form>
  );
}
