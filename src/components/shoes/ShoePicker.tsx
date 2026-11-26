"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { assignShoeAction } from "@/app/(app)/perfil/zapatillas/actions";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { shoeLabel } from "@/lib/shoes/shoes";

export interface ShoeOption {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  retired: boolean;
}

/**
 * Zapatilla de la carrera: un toque la guarda (tabla aparte: sobrevive a «Reprocesar» y pasa a la
 * del zip si sustituye a esta manual). Solo las activas, y la que ya tenga aunque esté retirada.
 */
export function ShoePicker({ runId, options, current }: { runId: string; options: ShoeOption[]; current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (id: string) => {
    if (id === value) return;
    const prev = value;
    setValue(id);
    setBusy(id);
    start(async () => {
      try {
        const r = await assignShoeAction(runId, id);
        if (r.ok) toast.success(r.message);
        else {
          setValue(prev);
          toast.error(r.message);
        }
      } catch {
        setValue(prev);
        toast.error("No se pudo guardar la zapatilla. Inténtalo de nuevo.");
      } finally {
        setBusy(null);
      }
    });
  };
  return (
    <section className="card p-5" aria-label="Zapatilla">
      <div className="eyebrow">Zapatilla</div>
      {options.length === 0 ? (
        <p className="mt-2 text-[14px] text-fg-2">
          Aún no tienes zapatillas.{" "}
          <Link href="/perfil/zapatillas" className="inline-flex min-h-[44px] items-center font-semibold text-lime-text underline-offset-2 hover:underline">
            Añadirlas en Perfil
          </Link>
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Zapatilla de esta carrera">
          {[...options.map((o) => ({ id: o.id, label: `${shoeLabel(o)}${o.retired ? " · retirada" : ""}` })), { id: "", label: "Sin zapatilla" }].map((o) => {
            const on = o.id === value;
            return (
              <button
                key={o.id || "none"}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={pending && !on}
                onClick={() => pick(o.id)}
                className={`flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border px-3.5 text-left text-[13px] font-semibold ${
                  on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg-2"
                }`}
              >
                {busy === o.id && <Spinner size={12} />}
                <span className="min-w-0 break-words">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
