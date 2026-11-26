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
  // La semana en curso y las futuras se vuelven a calcular con el ciclo nuevo.
  const { releaseFrom } = await import("@/lib/plan/plan-db");
  const { cacheDay: today } = await import("@/lib/cache/tags");
  await releaseFrom(db(), shiftWeek(v, today()).start);
  dataChanged();
  refresh();
  const { cacheDay } = await import("@/lib/cache/tags");
  const now = shiftWeek(v, cacheDay());
  return { ok: `Guardado. Esta semana: ${SHIFT_META[now.kind].label.toLowerCase()}.` };
}

/** Reorganizar la semana: mueve la sesión al primer día válido que queda (mismas reglas del turno). */
export async function rescheduleWeekAction(weekStart: string): Promise<{ ok: boolean; message: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { ok: false, message: "Semana no válida." };
  const [{ getShiftAnchor }, { getStoredWeeks, moveWeekDay }, { rescheduleDay }, { shiftWeek }, { cacheDay }, { fmtDay, SESSION_LABEL }] = await Promise.all([
    import("@/lib/plan/shifts-db"),
    import("@/lib/plan/plan-db"),
    import("@/lib/plan/compliance"),
    import("@/lib/plan/shifts"),
    import("@/lib/cache/tags"),
    import("@/lib/plan/weekly"),
  ]);
  const d = db();
  const [anchor, rows] = await Promise.all([getShiftAnchor(d), getStoredWeeks(d, weekStart, weekStart)]);
  const row = rows[0];
  if (!anchor || !row) return { ok: false, message: "No hay plan guardado para esa semana." };
  const today = cacheDay();
  const w = shiftWeek(anchor, weekStart);
  const session = row.session as Parameters<typeof rescheduleDay>[0]["session"];
  // Semana de carrera: como mucho 2 días antes de la carrera.
  const { listRaces } = await import("@/lib/race/race-db");
  const race = (await listRaces(d)).find((r) => r.date >= w.start && r.date <= w.end);
  const latest = race ? new Date(Date.parse(`${race.date}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10) : null;
  const { listShiftOverrides } = await import("@/lib/plan/shifts-db");
  const overrides = await listShiftOverrides(d, ymdShift(weekStart, -1), w.end);
  const day = rescheduleDay({ anchor, kind: w.kind, session, weekStart, today, latest, overrides });
  if (!day) return { ok: false, message: "No queda ningún día válido esta semana para esa sesión." };
  if (day === row.day) return { ok: true, message: `Sigue siendo el ${fmtDay(day)}.` };
  await moveWeekDay(d, weekStart, day, row.day, row.rescheduledFrom);
  dataChanged();
  refresh();
  return { ok: true, message: `${SESSION_LABEL[session as keyof typeof SESSION_LABEL]}: ahora el ${fmtDay(day)}.` };
}

/** AAAA-MM-DD desplazado n días. */
function ymdShift(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
