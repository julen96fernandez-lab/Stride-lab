"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { parseFeeling } from "@/lib/feelings/feelings";
import { deleteFeeling, saveFeeling } from "@/lib/feelings/feelings-db";

const UUID = /^[0-9a-f-]{36}$/i;

/** Guarda la sensación de una carrera (si queda vacía, se borra). */
export async function saveFeelingAction(runId: string, raw: { rating: number | null; note: string | null; tags: string[] }): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(runId)) return { ok: false, message: "Carrera no válida." };
  const p = parseFeeling(raw);
  if ("error" in p) return { ok: false, message: p.error };
  const r = await saveFeeling(db(), runId, p.feeling);
  dataChanged();
  refresh();
  return { ok: true, message: r === "deleted" ? "Sensación borrada." : "Sensación guardada." };
}

export async function deleteFeelingAction(runId: string): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(runId)) return { ok: false, message: "Carrera no válida." };
  await deleteFeeling(db(), runId);
  dataChanged();
  refresh();
  return { ok: true, message: "Sensación borrada." };
}
