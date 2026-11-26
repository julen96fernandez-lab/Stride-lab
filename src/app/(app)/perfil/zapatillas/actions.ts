"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { cacheDay } from "@/lib/cache/tags";
import { parseRange, parseShoe } from "@/lib/shoes/shoes";
import { assignShoe, bulkAssign, deleteShoe, saveShoe, setRetired } from "@/lib/shoes/shoes-db";

export type ShoeState = { ok?: string; error?: string };

const UUID = /^[0-9a-f-]{36}$/i;
const done = () => {
  dataChanged();
  refresh();
};

/** Crea o edita una zapatilla. */
export async function saveShoeAction(_prev: ShoeState, formData: FormData): Promise<ShoeState> {
  const id = String(formData.get("id") ?? "").trim() || null;
  if (id && !UUID.test(id)) return { error: "Zapatilla no válida." };
  const raw = Object.fromEntries(formData.entries());
  // La casilla de la cinta siempre va en el formulario: sin marcar = desactivada.
  raw.countTreadmill = formData.get("countTreadmill") ? "on" : "";
  const r = parseShoe(raw, cacheDay());
  if ("error" in r) return { error: r.error };
  const saved = await saveShoe(db(), r.shoe, id);
  if (!saved) return { error: "Esa zapatilla ya no existe." };
  done();
  return { ok: id ? "Zapatilla actualizada." : "Zapatilla añadida." };
}

/** Retirar (hoy) o volver a activar. */
export async function retireShoeAction(id: string, retire: boolean): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(id)) return { ok: false, message: "Zapatilla no válida." };
  const ok = await setRetired(db(), id, retire ? cacheDay() : null);
  if (ok) done();
  return ok ? { ok, message: retire ? "Zapatilla retirada." : "Zapatilla activa de nuevo." } : { ok, message: "Esa zapatilla ya no existe." };
}

export async function deleteShoeAction(id: string): Promise<{ ok: boolean }> {
  if (!UUID.test(id)) return { ok: false };
  const ok = await deleteShoe(db(), id);
  if (ok) done();
  return { ok };
}

/** «Asignar a todas las carreras entre dos fechas». */
export async function bulkAssignAction(_prev: ShoeState, formData: FormData): Promise<ShoeState> {
  const shoeId = String(formData.get("shoeId") ?? "");
  if (!UUID.test(shoeId)) return { error: "Elige una zapatilla." };
  const range = parseRange(Object.fromEntries(formData.entries()));
  if ("error" in range) return { error: range.error };
  const n = await bulkAssign(db(), shoeId, range.from, range.to, formData.get("overwrite") === "on");
  if (n === null) return { error: "Esa zapatilla ya no existe." };
  if (n > 0) done();
  return { ok: n === 0 ? "Ninguna carrera que cambiar en esas fechas." : n === 1 ? "Asignada a 1 carrera." : `Asignada a ${n} carreras.` };
}

/** Zapatilla de una carrera (desde su detalle); vacío = sin zapatilla. */
export async function assignShoeAction(runId: string, shoeId: string): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(runId) || (shoeId && !UUID.test(shoeId))) return { ok: false, message: "Datos no válidos." };
  try {
    await assignShoe(db(), runId, shoeId || null);
  } catch {
    return { ok: false, message: "No se pudo guardar la zapatilla." };
  }
  done();
  return { ok: true, message: shoeId ? "Zapatilla guardada." : "Carrera sin zapatilla." };
}
