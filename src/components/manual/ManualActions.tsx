"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteManualAction } from "@/app/(app)/actividad/manual-actions";

/** Editar y borrar (solo carreras manuales). Borrar pide un segundo toque. */
export function ManualActions({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <section className="card flex flex-col gap-2 p-4" aria-label="Carrera manual">
      <p className="text-[12px] text-fg-2">Añadida a mano. Si importas el zip de Salud y trae esta carrera, la del zip la sustituye y conserva el tipo y la nota.</p>
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/actividad/${id}/editar`} className="flex min-h-[48px] items-center justify-center rounded-2xl border border-line-strong text-[15px] font-semibold">
          Editar
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            start(async () => {
              const r = await deleteManualAction(id);
              if (!r.ok) setFailed(true);
            });
          }}
          className={`min-h-[48px] rounded-2xl text-[15px] font-semibold ${confirm ? "border border-danger text-danger" : "border border-line-strong text-fg-2"}`}
        >
          {pending ? "Borrando…" : confirm ? "Toca otra vez para borrar" : "Borrar"}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-[13px] text-danger">
          No se pudo borrar la carrera.
        </p>
      )}
    </section>
  );
}
