"use server";

import { db } from "@/lib/db/client";
import { isSessionType } from "@/lib/analysis/session-type";
import { validZones, type HrZones } from "@/lib/analysis/hr-zones";
import { ensureClassified, reclassifyAll, saveTypeSettings, saveZones, setManualType } from "@/lib/analysis/session-type-db";

/** Cambia el tipo de una carrera. "auto" vuelve al tipo automático. */
export async function setRunType(runId: string, type: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false };
  if (type !== "auto" && !isSessionType(type)) return { ok: false };
  await setManualType(db(), runId, type === "auto" ? null : type);
  return { ok: true };
}

export type SettingsState = { ok?: string; error?: string };

/** Guarda zonas y umbrales y vuelve a aplicar todo (zonas, carga y tipos automáticos). */
export async function saveTrainingSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const n = (k: string) => Number(String(formData.get(k) ?? "").replace(",", ".").trim());
  const zones: HrZones = {
    maxHr: Math.round(n("maxHr")),
    restHr: Math.round(n("restHr")),
    method: formData.get("method") === "max" ? "max" : "reserve",
    limits: [1, 2, 3, 4, 5].map((i) => Math.round(n(`z${i}`))) as HrZones["limits"],
  };
  if (!validZones(zones)) {
    return { error: "Revisa las zonas: los límites deben subir de Z1 a Z5 y no pasar del pulso máximo." };
  }
  const longRunKm = n("longRunKm");
  const trailMPerKm = n("trailMPerKm");
  if (!(longRunKm >= 5 && longRunKm <= 60)) return { error: "La tirada larga debe estar entre 5 y 60 km." };
  if (!(trailMPerKm >= 5 && trailMPerKm <= 200)) return { error: "El umbral de trail debe estar entre 5 y 200 m/km." };

  const d = db();
  await saveZones(d, zones);
  await saveTypeSettings(d, { longRunKm, trailMPerKm });
  const count = await reclassifyAll(d);
  await ensureClassified(d); // deja apuntada la versión de las reglas
  return { ok: `${count} carreras recalculadas.` };
}
