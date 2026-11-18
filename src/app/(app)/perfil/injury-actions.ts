"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { deleteInjury, saveInjury } from "@/lib/analysis/injuries-db";
import { reclassifyAll } from "@/lib/analysis/session-type-db";

export type InjuryState = { ok?: string; error?: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const validDay = (v: string) => YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Crea o edita un periodo de lesión. Sin fecha de fin = sigue abierto. */
export async function saveInjuryAction(_prev: InjuryState, formData: FormData): Promise<InjuryState> {
  const id = String(formData.get("id") ?? "").trim() || null;
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim().slice(0, 140) || null;
  if (id && !UUID.test(id)) return { error: "Periodo no válido." };
  if (!validDay(startDate)) return { error: "Indica la fecha de inicio." };
  if (endDate && !validDay(endDate)) return { error: "La fecha de fin no es válida." };
  if (endDate && endDate < startDate) return { error: "La fecha de fin no puede ser anterior al inicio." };

  const d = db();
  await saveInjury(d, { id, startDate, endDate, note });
  // Las carreras dentro del periodo dejan de contar en la base del clasificador.
  await reclassifyAll(d, { efforts: false });
  dataChanged();
  refresh();
  return { ok: id ? "Periodo actualizado." : "Periodo añadido." };
}

export async function deleteInjuryAction(id: string): Promise<{ ok: boolean }> {
  if (!UUID.test(id)) return { ok: false };
  const d = db();
  await deleteInjury(d, id);
  await reclassifyAll(d, { efforts: false });
  dataChanged();
  refresh();
  return { ok: true };
}
