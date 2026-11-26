"use client";

import { useState, useTransition } from "react";
import { linkSessionAction } from "@/app/(app)/plan/session-actions";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import type { LinkMode } from "@/lib/plan/linking";

export interface LinkRunOption {
  id: string;
  dayLabel: string;
  typeLabel: string;
  km: string | null;
}

const btn = "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold";

/**
 * Vínculo manual de una sesión prevista con una carrera de su semana: «Vincular con una carrera de
 * esta semana», «Desvincular» (sin carrera) y «Volver al automático». Lo manual manda.
 */
export function LinkControl({
  slot,
  mode,
  linkedRunId,
  options,
}: {
  slot: { mine: string } | { week: string };
  mode: LinkMode;
  linkedRunId: string | null;
  /** carreras ya hechas de su semana */
  options: LinkRunOption[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (to: string) =>
    start(async () => {
      setBusy(to);
      try {
        const r = await linkSessionAction(slot, to);
        if (r.ok) {
          toast.success(r.message);
          setOpen(false);
        } else toast.error(r.message);
      } catch {
        toast.error("No se pudo cambiar el vínculo. Inténtalo de nuevo.");
      } finally {
        setBusy(null);
      }
    });
  if (!options.length && mode === "auto") return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {mode !== "auto" && (
        <p className="text-[11px] text-fg-2">{mode === "manual" ? "Vínculo puesto a mano (manda sobre el cálculo)." : "Desvinculada a mano: queda sin carrera."}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${btn} border border-line-strong`}>
            Vincular con una carrera de esta semana
          </button>
        )}
        {linkedRunId && (
          <button type="button" disabled={pending} onClick={() => run("desvincular")} className={`${btn} border border-line-strong text-fg-2`}>
            {busy === "desvincular" && <Spinner size={12} />}
            Desvincular
          </button>
        )}
        {mode !== "auto" && (
          <button type="button" disabled={pending} onClick={() => run("auto")} className={`${btn} text-fg-2 underline-offset-2 hover:underline`}>
            {busy === "auto" && <Spinner size={12} />}
            Volver al automático
          </button>
        )}
      </div>
      {open && (
        <ul className="flex flex-col gap-1.5" aria-label="Carreras de esta semana">
          {options.map((o) => {
            const on = o.id === linkedRunId;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={pending || on}
                  aria-pressed={on}
                  onClick={() => run(o.id)}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl border px-3 text-left text-[13px] ${on ? "border-lime" : "border-line"}`}
                >
                  {busy === o.id ? <Spinner size={12} /> : <span aria-hidden="true">{on ? "✓" : "○"}</span>}
                  <span className="min-w-0 flex-1">
                    <b>{o.dayLabel}</b>
                    <span className="text-fg-2">
                      {" "}
                      · {o.typeLabel}
                      {o.km ? ` · ${o.km} km` : ""}
                    </span>
                  </span>
                  {on && <span className="text-[11px] font-semibold text-lime-text">vinculada</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
