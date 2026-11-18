"use client";

import { useTransition } from "react";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { rescheduleWeekAction } from "@/app/(app)/actividad/actions";

/** Mueve la sesión de la semana al primer día válido que queda (mismas reglas del turno). */
export function RescheduleButton({ weekStart, to }: { weekStart: string; to: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          try {
            const r = await rescheduleWeekAction(weekStart);
            if (r.ok) toast.success(r.message);
            else toast.error(r.message);
          } catch {
            toast.error("No se pudo reorganizar. Inténtalo de nuevo.");
          }
        })
      }
      className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-lime px-4 text-[15px] font-semibold text-lime-ink"
    >
      {pending && <Spinner />}
      {pending ? "Reorganizando…" : `Reorganizar: pasar al ${to}`}
    </button>
  );
}
