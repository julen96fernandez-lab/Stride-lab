"use client";

import { toast } from "./Toaster";
import { Spinner } from "./SubmitButton";
import { useEffect, useOptimistic, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRunType } from "@/app/(app)/actividad/actions";
import { SESSION_TYPES, TYPE_META, type SessionType } from "@/lib/analysis/session-type";
import { ManualMark, SessionIcon } from "./SessionType";

/**
 * Tipo de sesión de una carrera: se toca la etiqueta y se abre una hoja con todos los
 * tipos. Elegir uno lo guarda como tipo manual (manda siempre: ni Reprocesar ni
 * «Guardar y recalcular» lo cambian). «Volver a automático» borra el manual.
 */
export function TypePicker({
  runId,
  autoType,
  autoReason,
  manualType,
}: {
  runId: string;
  autoType: SessionType | null;
  autoReason: string | null;
  manualType: SessionType | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [manual, setManual] = useOptimistic<SessionType | null>(manualType);
  const current = manual ?? autoType;

  const open = () => dialog.current?.showModal();
  const close = () => dialog.current?.close();

  const choose = (t: SessionType | "auto") => {
    close();
    start(async () => {
      setManual(t === "auto" ? null : t);
      const res = await setRunType(runId, t);
      if (res.ok) {
        router.refresh(); // km por tipo, filtros y listas se recalculan en el servidor
        toast.success(t === "auto" ? "Tipo automático restaurado." : `Tipo: ${TYPE_META[t].label}.`);
      } else toast.error("No se pudo cambiar el tipo.");
    });
  };

  // Cerrar tocando fuera de la hoja.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  const m = current ? TYPE_META[current] : null;

  return (
    <section className="card p-4" aria-busy={pending}>
      <div className="flex items-baseline justify-between px-1">
        <div className="eyebrow">Tipo de sesión</div>
        <span className="text-[11px] text-fg-2">{manual ? "Elegido a mano" : "Automático"}</span>
      </div>

      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`Tipo: ${m ? m.label : "sin tipo"}${manual ? " (elegido a mano)" : ""}. Tocar para cambiar`}
        className="mt-3 flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-3.5 text-left transition"
        style={
          m
            ? { borderColor: `color-mix(in srgb, ${m.color} 45%, transparent)`, background: `color-mix(in srgb, ${m.color} 12%, transparent)` }
            : undefined
        }
      >
        {current && (
          <span style={{ color: TYPE_META[current].color }} className="flex">
            <SessionIcon type={current} size={20} />
          </span>
        )}
        <span className="flex-1 text-[16px] font-semibold">{m ? m.label : "Sin tipo"}</span>
        {manual && <ManualMark />}
        {pending ? <Spinner /> : <span className="text-[13px] font-semibold text-fg-2">Cambiar</span>}
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="text-fg-3">
          <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <p className="mt-2 px-1 text-[12px] leading-relaxed text-fg-2">
        {autoType ? (
          <>
            Automático: <span className="font-semibold text-fg">{TYPE_META[autoType].label}</span>
            {autoReason ? ` · ${autoReason}` : ""}
          </>
        ) : (
          "Sin tipo automático."
        )}
      </p>

      {/* Hoja inferior con todos los tipos */}
      <dialog
        ref={dialog}
        aria-labelledby={`tipo-${runId}`}
        className="m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-black/50 backdrop:backdrop-blur-sm sm:mx-auto sm:max-w-[440px]"
      >
        <div
          className="card mx-auto w-full max-w-[440px] rounded-b-none px-4 pt-3"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-ov-2" aria-hidden="true" />
          <div className="mt-3 flex items-center justify-between px-1">
            <h2 id={`tipo-${runId}`} className="font-display text-[20px] font-bold">
              Tipo de sesión
            </h2>
            <button type="button" onClick={close} className="min-h-[44px] px-2 text-[14px] font-semibold text-fg-2">
              Cerrar
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5" role="radiogroup" aria-label="Tipos">
            {SESSION_TYPES.map((t) => {
              const tm = TYPE_META[t];
              const active = current === t;
              return (
                <li key={t}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choose(t)}
                    className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-3.5 text-left text-[15px] font-semibold transition ${
                      active ? "border-lime bg-lime text-lime-ink" : "border-line bg-ov-1 text-fg"
                    }`}
                  >
                    <span
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-xl"
                      style={active ? undefined : { color: tm.color, background: `color-mix(in srgb, ${tm.color} 14%, transparent)` }}
                    >
                      <SessionIcon type={t} size={18} />
                    </span>
                    <span className="flex-1">{tm.label}</span>
                    {autoType === t && <span className={`text-[11px] font-medium ${active ? "" : "text-fg-2"}`}>automático</span>}
                    {active && (
                      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {manual && (
            <button
              type="button"
              onClick={() => choose("auto")}
              className="mt-3 min-h-[52px] w-full rounded-2xl border border-line-strong text-[15px] font-semibold text-fg"
            >
              Volver a automático{autoType ? ` (${TYPE_META[autoType].label})` : ""}
            </button>
          )}
        </div>
      </dialog>
    </section>
  );
}
