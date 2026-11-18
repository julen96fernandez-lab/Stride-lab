"use client";

import { useTransition } from "react";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { restoreSuggestionAction } from "./session-actions";

/** Vuelve a mostrar la sugerencia quitada de una semana. */
export function RestoreSuggestion({ weekStart }: { weekStart: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          try {
            const r = await restoreSuggestionAction(weekStart);
            if (r.ok) toast.success(r.message);
            else toast.error(r.message);
          } catch {
            toast.error("No se pudo recuperar. Inténtalo de nuevo.");
          }
        })
      }
      className="-my-2 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-[13px] font-semibold text-fg underline-offset-2 hover:underline"
    >
      {pending && <Spinner size={12} />}
      Recuperarla
    </button>
  );
}
