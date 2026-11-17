"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { DEFAULT_TYPE_SETTINGS, isSessionType } from "@/lib/analysis/session-type";
import { reclassifyAll, saveTypeSettings, setManualType } from "@/lib/analysis/session-type-db";

/** Cambia el tipo de una carrera. "auto" vuelve al tipo automático. */
export async function setRunType(runId: string, type: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false };
  if (type !== "auto" && !isSessionType(type)) return { ok: false };
  await setManualType(db(), runId, type === "auto" ? null : type);
  return { ok: true };
}

/** Guarda los umbrales configurables y recalcula los tipos automáticos. */
export async function saveTypeSettingsAction(formData: FormData): Promise<void> {
  const num = (k: string, lo: number, hi: number, def: number) => {
    const v = Number(String(formData.get(k) ?? "").replace(",", "."));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : def;
  };
  await saveTypeSettings(db(), {
    longRunKm: num("longRunKm", 5, 60, DEFAULT_TYPE_SETTINGS.longRunKm),
    trailMPerKm: num("trailMPerKm", 5, 200, DEFAULT_TYPE_SETTINGS.trailMPerKm),
  });
  await reclassifyAll(db());
  redirect("/perfil?tipos=ok");
}
