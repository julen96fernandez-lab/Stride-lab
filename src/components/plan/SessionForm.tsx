"use client";

import { useActionState, useState, useTransition } from "react";
import { SubmitButton, Spinner } from "@/components/ui/SubmitButton";
import { useActionToast } from "@/components/ui/Toaster";
import { deleteMineAction, dismissSuggestionAction, saveMineAction, type MineState } from "@/app/(app)/plan/session-actions";
import { MINE_KINDS, MINE_LABEL, MINE_NOTE_MAX, type MineKind } from "@/lib/plan/mine";

const field = "h-11 w-full rounded-xl border border-line-strong bg-inset px-3 text-[16px] text-fg outline-none focus:border-lime";
const label = "flex flex-col gap-1.5 text-[13px] text-fg-2";

export interface SessionFormValues {
  id?: string;
  date: string;
  kind: MineKind;
  distanceKm: string;
  duration: string;
  note: string;
  /** al editar la sugerida: semana (lunes) cuya sugerencia sustituye */
  replacesWeek?: string | null;
  /** «inicio» para volver a Inicio al guardar */
  volver?: string | null;
}

/** Añadir o editar una sesión prevista mía. Con `suggestion`, permite además quitar la sugerida. */
export function SessionForm({ initial, suggestionWeek }: { initial: SessionFormValues; suggestionWeek?: string | null }) {
  const [state, action] = useActionState<MineState, FormData>(saveMineAction, {});
  useActionToast(state);
  const err = state.errors ?? {};
  const [kind, setKind] = useState<MineKind>(initial.kind);
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<null | "delete" | "dismiss">(null);

  const twoTap = (what: "delete" | "dismiss", fn: () => Promise<unknown>) => {
    if (confirm !== what) return setConfirm(what);
    start(async () => {
      await fn();
    });
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {initial.replacesWeek && <input type="hidden" name="replacesWeek" value={initial.replacesWeek} />}
      {initial.volver && <input type="hidden" name="volver" value={initial.volver} />}
      <input type="hidden" name="kind" value={kind} />

      <section className="card flex flex-col gap-4 p-5">
        <div className={label}>
          Tipo
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de sesión">
            {MINE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`min-h-[48px] rounded-2xl border px-3 text-[15px] font-semibold transition ${kind === k ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg"}`}
              >
                {MINE_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        {err.kind && <Err>{err.kind}</Err>}
        <label className={label}>
          Fecha
          <input type="date" name="date" defaultValue={initial.date} className={field} />
        </label>
        {err.date && <Err>{err.date}</Err>}
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <div className="eyebrow">Opcional</div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Distancia (km)
            <input name="distanceKm" inputMode="decimal" defaultValue={initial.distanceKm} placeholder="Ej.: 12" className={field} />
          </label>
          <label className={label}>
            Duración
            <input name="duration" inputMode="numeric" defaultValue={initial.duration} placeholder="45 o 1:15" className={field} />
          </label>
        </div>
        {err.distance && <Err>{err.distance}</Err>}
        {err.duration && <Err>{err.duration}</Err>}
        <label className={label}>
          Nota
          <textarea
            name="note"
            defaultValue={initial.note}
            maxLength={MINE_NOTE_MAX}
            rows={2}
            placeholder="Ej.: 6 × 1000 en pista, con Ane…"
            className="w-full resize-none rounded-xl border border-line-strong bg-inset px-3 py-2.5 text-[16px] text-fg outline-none placeholder:text-fg-3 focus:border-lime"
          />
        </label>
        {err.note && <Err>{err.note}</Err>}
      </section>

      {state.error && <Err>{state.error}</Err>}
      <SubmitButton pending="Guardando…">{initial.id ? "Guardar cambios" : "Guardar sesión"}</SubmitButton>
      <p className="-mt-2 text-center text-[12px] text-fg-2">Se marca «Puesta por mí» y manda sobre la sugerencia.</p>

      {initial.id && (
        <TwoTap busy={busy} armed={confirm === "delete"} onClick={() => twoTap("delete", () => deleteMineAction(initial.id!))} idle="Borrar sesión" armedText="Toca otra vez para borrarla" busyText="Borrando…" />
      )}
      {suggestionWeek && !initial.id && (
        <TwoTap
          busy={busy}
          armed={confirm === "dismiss"}
          onClick={() => twoTap("dismiss", () => dismissSuggestionAction(suggestionWeek))}
          idle="Quitar la sugerencia de esa semana"
          armedText="Toca otra vez para quitarla"
          busyText="Quitando…"
        />
      )}
    </form>
  );
}

function TwoTap({ busy, armed, onClick, idle, armedText, busyText }: { busy: boolean; armed: boolean; onClick: () => void; idle: string; armedText: string; busyText: string }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold ${armed ? "border border-danger text-danger" : "border border-line-strong text-fg-2"}`}
    >
      {busy && <Spinner />}
      {busy ? busyText : armed ? armedText : idle}
    </button>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  );
}
