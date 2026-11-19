"use server";

import { calendarScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { blockRange, type CalendarBlock } from "@/lib/plan/calendar";

/** Siguiente bloque del calendario (±3 meses alrededor de ese mes) al pasar del que ya hay. */
export async function calendarBlockAction(year: number, month: number): Promise<CalendarBlock | null> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const { from, to } = blockRange({ year, month });
  return calendarScreen(cacheDay(), from, to);
}
