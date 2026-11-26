"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { SubmitButton, Spinner } from "@/components/ui/SubmitButton";
import { toast, useActionToast } from "@/components/ui/Toaster";
import type { ShoeView } from "@/lib/shoes/shoes-db";
import { SHOE_RULES, shoeLabel } from "@/lib/shoes/shoes";
import { bulkAssignAction, deleteShoeAction, retireShoeAction, saveShoeAction, type ShoeState } from "./actions";

const field = "h-11 w-full min-w-0 rounded-xl border border-line-strong bg-inset px-3 text-[16px] text-fg outline-none focus:border-lime";
const btn = "flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] font-semibold text-fg-2";
const fmt = (ymd: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T12:00:00Z`)).replace(".", "");
const km0 = (x: number) => Math.round(x).toLocaleString("es-ES");

/** Garaje: lista con uso frente al límite, alta y edición, retirada y asignación masiva. */
export function ShoesManager({ shoes, today }: { shoes: ShoeView[]; today: string }) {
  const [editing, setEditing] = useState<string | "new" | null>(shoes.length ? null : "new");
  const active = shoes.filter((x) => !x.retiredAt);
  const retired = shoes.filter((x) => x.retiredAt);
  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3 p-5" aria-label="Zapatillas activas">
        <div className="eyebrow">Activas</div>
        {active.length === 0 && editing !== "new" && <p className="text-[14px] text-fg-2">Aún no has añadido zapatillas.</p>}
        <ul className="flex flex-col gap-2.5">
          {active.map((x) => (
            <li key={x.id}>
              {editing === x.id ? <ShoeEditor shoe={x} today={today} onDone={() => setEditing(null)} /> : <ShoeCard shoe={x} onEdit={() => setEditing(x.id)} />}
            </li>
          ))}
        </ul>
        {editing === "new" ? (
          <ShoeEditor today={today} onDone={() => setEditing(null)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="min-h-[48px] w-full rounded-2xl border border-dashed border-line-strong text-[15px] font-semibold text-fg-2"
          >
            + Añadir zapatilla
          </button>
        )}
      </section>

      {shoes.length > 0 && <BulkAssign shoes={shoes} today={today} />}

      {retired.length > 0 && (
        <section className="card flex flex-col gap-3 p-5" aria-label="Zapatillas retiradas">
          <div className="eyebrow">Retiradas</div>
          <ul className="flex flex-col gap-2.5">
            {retired.map((x) => (
              <li key={x.id}>
                {editing === x.id ? <ShoeEditor shoe={x} today={today} onDone={() => setEditing(null)} /> : <ShoeCard shoe={x} onEdit={() => setEditing(x.id)} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function UsageBar({ shoe }: { shoe: ShoeView }) {
  const u = shoe.usage;
  const color = u.over ? "var(--load-high)" : u.warn ? "var(--load-mod)" : "var(--lime)";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--chart-bar)]"
      role="meter"
      aria-label={`Uso: ${Math.round(u.pct * 100)} % del límite`}
      aria-valuemin={0}
      aria-valuemax={Math.round(shoe.limitKm)}
      aria-valuenow={Math.round(Math.min(shoe.km, shoe.limitKm))}
    >
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, u.pct * 100)}%`, background: shoe.retiredAt ? "var(--fg-3)" : color }} />
    </div>
  );
}

function ShoeCard({ shoe, onEdit }: { shoe: ShoeView; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const extra = [shoe.brand, shoe.model].filter(Boolean).join(" ");
  const meta = [
    shoe.runs === 1 ? "1 carrera" : `${shoe.runs} carreras`,
    shoe.assigned > shoe.runs ? `${shoe.assigned - shoe.runs} más que no suman (${shoe.countTreadmill ? "no válidas" : "en cinta"})` : null,
    shoe.initialKm ? `${km0(shoe.initialKm)} km iniciales` : null,
    shoe.purchasedAt ? `comprada el ${fmt(shoe.purchasedAt)}` : null,
    shoe.retiredAt ? `retirada el ${fmt(shoe.retiredAt)}` : null,
    shoe.countTreadmill || shoe.assigned > shoe.runs ? null : "sin cinta",
  ].filter(Boolean);
  const retire = (v: boolean) =>
    start(async () => {
      try {
        const r = await retireShoeAction(shoe.id, v);
        (r.ok ? toast.success : toast.error)(r.message);
      } catch {
        toast.error("No se pudo cambiar. Inténtalo de nuevo.");
      }
    });
  return (
    <div className="rounded-2xl border border-line bg-inset p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold break-words">
            {shoe.name}
            {shoe.isDefault && <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-ink">HABITUAL</span>}
          </div>
          {extra && extra !== shoe.name && <div className="mt-0.5 text-[12px] break-words text-fg-2">{extra}</div>}
        </div>
        <div className="flex-none text-right">
          <div className="num text-[17px]">{km0(shoe.km)} km</div>
          <div className="text-[11px] text-fg-2">de {km0(shoe.limitKm)}</div>
        </div>
      </div>
      <div className="mt-2.5">
        <UsageBar shoe={shoe} />
      </div>
      {shoe.usage.message && !shoe.retiredAt && (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug">
          <span className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: shoe.usage.over ? "var(--load-high)" : "var(--load-mod)" }} aria-hidden="true" />
          {shoe.usage.message}
        </p>
      )}
      <p className="mt-1.5 text-[12px] text-fg-2">{meta.join(" · ")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onEdit} className={btn}>
          Editar
        </button>
        <button type="button" disabled={pending} onClick={() => retire(!shoe.retiredAt)} className={btn}>
          {pending && <Spinner size={12} />}
          {shoe.retiredAt ? "Volver a activar" : "Retirar"}
        </button>
      </div>
    </div>
  );
}

function ShoeEditor({ shoe, today, onDone }: { shoe?: ShoeView; today: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<ShoeState, FormData>(saveShoeAction, {});
  useActionToast(state);
  const [confirm, setConfirm] = useState(false);
  const [deleting, startDelete] = useTransition();
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-lime bg-inset p-3.5" aria-label={shoe ? `Editar ${shoe.name}` : "Nueva zapatilla"}>
      {shoe && <input type="hidden" name="id" value={shoe.id} />}
      <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
        Nombre
        <input name="name" required maxLength={SHOE_RULES.maxName} defaultValue={shoe?.name ?? ""} placeholder="Ej.: Diarias" className={field} />
      </label>
      <div className="form-row">
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
          Marca (opcional)
          <input name="brand" maxLength={SHOE_RULES.maxText} defaultValue={shoe?.brand ?? ""} className={field} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
          Modelo (opcional)
          <input name="model" maxLength={SHOE_RULES.maxText} defaultValue={shoe?.model ?? ""} className={field} />
        </label>
      </div>
      <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
        Fecha de compra (opcional)
        <input type="date" name="purchasedAt" max={today} defaultValue={shoe?.purchasedAt ?? ""} className={field} />
      </label>
      <div className="form-row">
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
          Km iniciales (opcional)
          <input name="initialKm" inputMode="decimal" defaultValue={shoe?.initialKm ? String(shoe.initialKm).replace(".", ",") : ""} placeholder="0" className={field} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
          Límite (km)
          <input name="limitKm" inputMode="decimal" defaultValue={String(shoe?.limitKm ?? SHOE_RULES.defaultLimitKm).replace(".", ",")} className={field} />
        </label>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
        <input type="checkbox" name="countTreadmill" defaultChecked={shoe?.countTreadmill ?? true} className="h-4 w-4 flex-none accent-[var(--lime)]" />
        Contar carreras en cinta
      </label>
      {!shoe?.retiredAt && (
        <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
          <input type="checkbox" name="isDefault" defaultChecked={shoe?.isDefault ?? false} className="h-4 w-4 flex-none accent-[var(--lime)]" />
          Habitual (se preselecciona al añadir una carrera a mano)
        </label>
      )}
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
      {shoe && (
        <button
          type="button"
          disabled={deleting || pending}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            startDelete(async () => {
              try {
                const r = await deleteShoeAction(shoe.id);
                if (!r.ok) throw new Error("no borrada");
                toast.success("Zapatilla borrada.");
                onDone();
              } catch {
                toast.error("No se pudo borrar. Inténtalo de nuevo.");
              }
            });
          }}
          aria-busy={deleting || undefined}
          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[14px] font-semibold ${confirm ? "border border-danger text-danger" : "text-fg-2"}`}
        >
          {deleting && <Spinner />}
          {deleting ? "Borrando…" : confirm ? "Toca otra vez: se quita de sus carreras" : "Borrar zapatilla"}
        </button>
      )}
    </form>
  );
}

function BulkAssign({ shoes, today }: { shoes: ShoeView[]; today: string }) {
  const [state, action] = useActionState<ShoeState, FormData>(bulkAssignAction, {});
  useActionToast(state);
  const first = shoes.find((x) => x.isDefault) ?? shoes.find((x) => !x.retiredAt) ?? shoes[0];
  return (
    <form action={action} className="card flex flex-col gap-3 p-5" aria-label="Asignar entre dos fechas">
      <div>
        <div className="eyebrow">Asignar a todas las carreras entre dos fechas</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Solo rellena las que no tienen zapatilla. Si la zapatilla no cuenta la cinta, las de cinta se quedan como están.
        </p>
      </div>
      <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
        Zapatilla
        <select name="shoeId" defaultValue={first.id} className={field}>
          {shoes.map((x) => (
            <option key={x.id} value={x.id}>
              {shoeLabel(x)}
              {x.retiredAt ? " · retirada" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
          Desde
          <input type="date" name="from" required max={today} defaultValue={first.purchasedAt ?? ""} className={field} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-fg-2">
          Hasta
          <input type="date" name="to" required max={today} defaultValue={today} className={field} />
        </label>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
        <input type="checkbox" name="overwrite" className="h-4 w-4 flex-none accent-[var(--lime)]" />
        También las que ya tienen otra
      </label>
      {state.error && (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton pending="Asignando…" className="min-h-[44px] rounded-xl text-[15px]">
        Asignar
      </SubmitButton>
    </form>
  );
}
