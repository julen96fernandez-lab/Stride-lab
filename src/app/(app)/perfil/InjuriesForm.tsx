"use client";

import { SubmitButton, Spinner } from "@/components/ui/SubmitButton";
import { toast, useActionToast } from "@/components/ui/Toaster";
import { useActionState, useEffect, useState, useTransition } from "react";
import { deleteInjuryAction, saveInjuryAction, type InjuryState } from "./injury-actions";

export interface InjuryRow {
  id: string;
  startDate: string;
  endDate: string | null;
  note: string | null;
  runs: number;
}

const field = "h-11 w-full rounded-xl border border-line-strong bg-inset px-3 text-[16px] text-fg outline-none focus:border-lime";

const fmt = (ymd: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${ymd}T12:00:00Z`))
    .replace(".", "");
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** Periodos de lesión: añadir, editar y borrar. Fin opcional (periodo abierto). */
export function InjuriesForm({ injuries, today }: { injuries: InjuryRow[]; today: string }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <section id="lesiones" className="card scroll-mt-6 flex flex-col gap-4 p-5">
      <div>
        <div className="eyebrow">Periodos de lesión</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Las carreras dentro de un periodo se guardan y se ven, y sus km cuentan. No cuentan en los ritmos medios, las sugerencias de
          objetivos, las comparaciones ni la base para clasificar sesiones. Sí cuentan en los récords.
        </p>
      </div>

      {injuries.length === 0 && editing !== "new" && <p className="text-[14px] text-fg-2">Sin periodos de lesión.</p>}

      {injuries.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {injuries.map((i) =>
            editing === i.id ? (
              <li key={i.id}>
                <InjuryEditor injury={i} today={today} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={i.id} className="rounded-2xl border border-line bg-inset p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">
                      {fmt(i.startDate)} → {i.endDate ? fmt(i.endDate) : "hoy"}
                      {!i.endDate && <span className="ml-2 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-ink">ABIERTO</span>}
                    </div>
                    <div className="mt-0.5 text-[12px] text-fg-2">
                      {days(i.startDate, i.endDate ?? today)} días · {i.runs} {i.runs === 1 ? "carrera" : "carreras"}
                    </div>
                    {i.note && <p className="mt-1.5 text-[13px] break-words">{i.note}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(i.id)}
                    className="min-h-[44px] flex-none rounded-full border border-line-strong px-3.5 text-[13px] font-semibold text-fg-2"
                  >
                    Editar
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {editing === "new" ? (
        <InjuryEditor today={today} onDone={() => setEditing(null)} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="min-h-[48px] w-full rounded-2xl border border-dashed border-line-strong text-[15px] font-semibold text-fg-2"
        >
          + Añadir periodo
        </button>
      )}
    </section>
  );
}

function InjuryEditor({ injury, today, onDone }: { injury?: InjuryRow; today: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<InjuryState, FormData>(saveInjuryAction, {});
  useActionToast(state);
  const [open, setOpen] = useState(injury ? injury.endDate === null : true);
  const [confirm, setConfirm] = useState(false);
  const [deleting, startDelete] = useTransition();
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-lime bg-inset p-3.5">
      {injury && <input type="hidden" name="id" value={injury.id} />}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
          Inicio
          <input type="date" name="startDate" required max={today} defaultValue={injury?.startDate ?? today} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
          Fin
          {open ? (
            <span className="flex h-11 items-center rounded-xl border border-line px-3 text-[15px] text-fg-2">Abierto</span>
          ) : (
            <input type="date" name="endDate" required defaultValue={injury?.endDate ?? today} className={field} />
          )}
        </label>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="h-4 w-4 accent-[var(--lime)]" />
        Sigue abierto (sin fecha de fin)
      </label>
      <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
        Nota (opcional)
        <input name="note" maxLength={140} defaultValue={injury?.note ?? ""} placeholder="Ej.: sobrecarga en el gemelo" className={field} />
      </label>
      {state.error && (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <SubmitButton pending="Guardando…" disabled={deleting} className="min-h-[44px] flex-1 rounded-xl text-[15px]">
          Guardar
        </SubmitButton>
        <button type="button" onClick={onDone} className="min-h-[44px] rounded-xl border border-line-strong px-4 text-[15px] font-semibold text-fg-2">
          Cancelar
        </button>
      </div>
      {injury && (
        <button
          type="button"
          disabled={deleting || pending}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            startDelete(async () => {
              try {
                const r = await deleteInjuryAction(injury.id);
                if (!r.ok) throw new Error("no borrado");
                toast.success("Periodo borrado.");
                onDone();
              } catch {
                toast.error("No se pudo borrar el periodo. Inténtalo de nuevo.");
              }
            });
          }}
          aria-busy={deleting || undefined}
          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[14px] font-semibold ${confirm ? "border border-danger text-danger" : "text-fg-2"}`}
        >
          {deleting && <Spinner />}
          {deleting ? "Borrando…" : confirm ? "Toca otra vez para borrar el periodo" : "Borrar periodo"}
        </button>
      )}
    </form>
  );
}
