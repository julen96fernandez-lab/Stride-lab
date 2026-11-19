"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Hoja inferior: sube desde abajo, por encima de la barra de pestañas (se pinta en el <body> con
 * un portal: dentro de la página quedaría bajo la barra, que va en otra capa). Se cierra con la ✕, tocando
 * fuera, con Escape o deslizando hacia abajo desde el asa. Bloquea el desplazamiento de la página
 * mientras está abierta y lleva el foco a la hoja.
 */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="Cerrar" tabIndex={-1} onClick={onClose} className="sheet-backdrop absolute inset-0 bg-black/45" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        // Al seguir un enlace de la hoja se cierra (al volver atrás no sigue abierta).
        onClickCapture={(e) => {
          if ((e.target as Element).closest("a[href]")) onClose();
        }}
        className="sheet-panel relative mx-auto flex max-h-[85dvh] w-full max-w-[560px] flex-col rounded-t-[28px] border border-b-0 border-line-strong bg-[var(--card)] shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.6)] outline-none"
      >
        <div
          className="flex flex-none touch-none flex-col px-5 pt-2"
          onTouchStart={(e) => (drag.current = e.touches[0].clientY)}
          onTouchEnd={(e) => {
            if (drag.current !== null && e.changedTouches[0].clientY - drag.current > 70) onClose();
            drag.current = null;
          }}
        >
          <span className="mx-auto h-1.5 w-10 rounded-full bg-ov-2" aria-hidden="true" />
          <div className="mt-1 flex items-center justify-between gap-2">
            <h2 id={id} className="min-w-0 text-[18px] font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-fg-2 hover:bg-ov-2">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-[calc(env(safe-area-inset-bottom)+20px)]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
