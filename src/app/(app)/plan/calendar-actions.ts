"use server";

import { calendarScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { blockRange, type CalendarBlock } from "@/lib/plan/calendar";

/** Siguiente bloque del calendario (±3 meses alrededor de ese mes) al pasar del que ya hay. */
export async function calendarBlockAction(year: number, month: number): Promise<CalendarBlock | null> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const { from, to } = blockRange({ year, month });
  return calendarScreen(from, to, cacheDay());
}

/**
 * Cambia el turno de un día concreto (o lo devuelve al del ciclo con `kind` null). Las reglas del
 * plan (sugerencias, avisos, «Hoy») pasan a usar el turno efectivo de ese día.
 */
export async function setDayShiftAction(date: string, kind: string | null): Promise<{ ok: boolean; message: string }> {
  const { dayNum, isShiftKind, DAY_SHIFT_LABEL } = await import("@/lib/plan/shifts");
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayNum(date) : null;
  const t = dayNum(cacheDay())!;
  if (d === null || d < t - 400 || d > t + 400) return { ok: false, message: "Fecha no válida." };
  if (kind !== null && !isShiftKind(kind)) return { ok: false, message: "Turno no válido." };
  const [{ db }, { setShiftOverride }, { dataChanged }, { refresh }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/plan/shifts-db"),
    import("@/lib/cache/invalidate"),
    import("next/cache"),
  ]);
  await setShiftOverride(db(), date, kind);
  dataChanged();
  refresh();
  return { ok: true, message: kind ? `Turno de ese día: ${DAY_SHIFT_LABEL[kind].toLowerCase()}. El plan se ha recalculado.` : "Turno del ciclo de nuevo para ese día." };
}
