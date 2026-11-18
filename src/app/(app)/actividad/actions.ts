"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { isSessionType } from "@/lib/analysis/session-type";
import { validZones, type HrZones } from "@/lib/analysis/hr-zones";
import { ensureClassified, reclassifyAll, saveTypeSettings, saveZones, setManualType } from "@/lib/analysis/session-type-db";

/** Cambia el tipo de una carrera. "auto" vuelve al tipo automático. */
export async function setRunType(runId: string, type: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { ok: false };
  if (type !== "auto" && !isSessionType(type)) return { ok: false };
  await setManualType(db(), runId, type === "auto" ? null : type);
  dataChanged();
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
  dataChanged();
  refresh();
  return { ok: `${count} carreras recalculadas.` };
}

export type GoalsState = { ok?: string; error?: string };

/** Objetivos de km (semana, mes, año). Vacío = sin objetivo; «pausar» lo oculta sin borrarlo. */
export async function saveGoalsAction(_prev: GoalsState, formData: FormData): Promise<GoalsState> {
  const { saveGoals } = await import("@/lib/analysis/goals-db");
  const read = (k: "week" | "month" | "year", max: number) => {
    const raw = String(formData.get(`${k}Km`) ?? "").replace(",", ".").trim();
    const km = raw === "" ? null : Number(raw);
    if (km !== null && !(km > 0 && km <= max)) throw new Error(k);
    return { km: km === null ? null : Math.round(km * 10) / 10, paused: formData.get(`${k}Paused`) === "on" };
  };
  try {
    await saveGoals(db(), { week: read("week", 500), month: read("month", 2000), year: read("year", 20000) });
  } catch (e) {
    const which = { week: "semanal", month: "mensual", year: "anual" }[(e as Error).message] ?? "";
    return { error: `Revisa el objetivo ${which}: debe ser un número de km mayor que 0.` };
  }
  dataChanged();
  refresh();
  return { ok: "Objetivos guardados." };
}

export type ShiftState = { ok?: string; error?: string };

/** Lunes de inicio de un bloque de tardes: a partir de él se calculan todas las semanas del ciclo. */
export async function saveShiftAnchorAction(_prev: ShiftState, formData: FormData): Promise<ShiftState> {
  const { saveShiftAnchor } = await import("@/lib/plan/shifts-db");
  const { isMonday, shiftWeek, SHIFT_META } = await import("@/lib/plan/shifts");
  const v = String(formData.get("shiftAnchor") ?? "").trim();
  if (!isMonday(v)) return { error: "Elige un lunes: los bloques van de lunes a domingo." };
  await saveShiftAnchor(db(), v);
  dataChanged();
  refresh();
  const { cacheDay } = await import("@/lib/cache/tags");
  const now = shiftWeek(v, cacheDay());
  return { ok: `Guardado. Esta semana: ${SHIFT_META[now.kind].label.toLowerCase()}.` };
}
