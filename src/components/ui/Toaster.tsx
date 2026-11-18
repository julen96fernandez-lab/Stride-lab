"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { feedbackFromState, toastReducer, type ActionState, type Toast, type ToastAction, type ToastKind } from "@/lib/ui/feedback";

// Almacén global de avisos (un solo Toaster en la app).
let state = { list: [] as Toast[], next: 1 };
const subs = new Set<() => void>();
function dispatch(a: ToastAction) {
  state = toastReducer(state, a);
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const EMPTY: Toast[] = [];

/** Mostrar un aviso breve desde cualquier componente cliente. */
export const toast = {
  show: (kind: ToastKind, text: string, ttl?: number) => dispatch({ type: "push", toast: { kind, text, ttl } }),
  success: (text: string) => dispatch({ type: "push", toast: { kind: "success", text } }),
  error: (text: string) => dispatch({ type: "push", toast: { kind: "error", text } }),
};

function Item({ t }: { t: Toast }) {
  useEffect(() => {
    const id = setTimeout(() => dispatch({ type: "dismiss", id: t.id }), t.ttl);
    return () => clearTimeout(id);
  }, [t]);
  const ok = t.kind === "success";
  const err = t.kind === "error";
  return (
    <li
      role={err ? "alert" : "status"}
      className="toast-in pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-line-strong px-4 py-3 text-[14px] shadow-[0_16px_40px_-14px_rgba(0,0,0,0.6)] backdrop-blur-xl"
      style={{ background: "color-mix(in srgb, var(--card) 88%, transparent)" }}
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${ok ? "bg-lime text-lime-ink" : err ? "bg-danger text-white" : "bg-ov-2 text-fg"}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {ok ? <path d="m5 12 5 5 9-10" /> : err ? <path d="M12 7v6M12 17h.01" /> : <path d="M12 8h.01M12 12v5" />}
        </svg>
      </span>
      <span className="min-w-0 flex-1 leading-snug">{t.text}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={() => dispatch({ type: "dismiss", id: t.id })} className="-mr-2 flex h-11 w-11 flex-none items-center justify-center text-fg-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </li>
  );
}

/** Avisos arriba de la pantalla (por encima del contenido y de la barra inferior). */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => state.list, () => EMPTY);
  return (
    <ol aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-full max-w-[440px] flex-col gap-2 px-4" style={{ top: "calc(env(safe-area-inset-top) + 10px)" }}>
      {list.map((t) => (
        <Item key={t.id} t={t} />
      ))}
    </ol>
  );
}

/** Lanza el aviso de un formulario cuando su acción termina (éxito o error). */
export function useActionToast(s: ActionState | undefined) {
  const prev = useRef(s);
  useEffect(() => {
    if (prev.current === s) return;
    const f = feedbackFromState(prev.current, s);
    prev.current = s;
    if (f) toast.show(f.kind, f.text);
  }, [s]);
}
