"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { actionPhase, type ActionState } from "@/lib/ui/feedback";

/** Indicador de actividad (respeta «reducir movimiento»: gira más despacio). */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="spin flex-none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const VARIANT = {
  primary: "bg-lime text-lime-ink",
  ghost: "border border-line-strong bg-[var(--card)] text-fg",
  danger: "border border-danger text-danger",
} as const;

/**
 * Botón de envío de un formulario: mientras la acción trabaja, desactivado, con spinner y el
 * texto `pending`. El aviso de éxito o error lo pone el formulario (useActionToast).
 */
export function SubmitButton({
  children,
  pending: pendingLabel,
  variant = "primary",
  className = "",
  name,
  value,
  disabled,
  state,
}: {
  children: ReactNode;
  pending?: ReactNode;
  variant?: keyof typeof VARIANT;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** estado de la acción: al terminar, el botón muestra un instante ✓ o ✕ */
  state?: ActionState;
}) {
  const { pending, data } = useFormStatus();
  const phase = useSettledPhase(pending, state);
  // Con varios botones de envío (p. ej. «Ver resumen» y «Guardar»), solo gira el pulsado.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={mine || undefined}
      className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold ${VARIANT[variant]} ${className}`}
    >
      {mine ? <Spinner /> : phase === "done" ? <Mark ok /> : phase === "error" ? <Mark ok={false} /> : null}
      <span>{mine && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}

/** Fase tras terminar: «hecho» o «error» durante un momento, luego vuelve a reposo. */
function useSettledPhase(pending: boolean, state: ActionState | undefined) {
  const seen = useRef(state);
  const [settledAt, setSettledAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    const t0 = Date.now();
    setSettledAt(t0);
    setNow(t0);
    const id = setTimeout(() => setNow(Date.now()), 1700);
    return () => clearTimeout(id);
  }, [state]);
  return state ? actionPhase(pending, state, settledAt, now) : pending ? "pending" : "idle";
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="pop-in flex-none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}
