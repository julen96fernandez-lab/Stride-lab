import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { WeekSession } from "./weekly";

export type StoredWeek = typeof s.planWeeks.$inferSelect;

export async function getStoredWeeks(db: Db, from: string, to: string): Promise<StoredWeek[]> {
  return db.select().from(s.planWeeks).where(and(gte(s.planWeeks.weekStart, from), lte(s.planWeeks.weekStart, to)));
}

/** Congela el plan de una semana (si ya estaba guardado, no lo toca). */
export async function freezeWeek(db: Db, w: WeekSession): Promise<void> {
  await db
    .insert(s.planWeeks)
    .values({ weekStart: w.start, shiftKind: w.kind, session: w.session, day: w.day, whenText: w.when, reason: w.reason, downgraded: w.downgraded })
    .onConflictDoNothing();
}

export async function moveWeekDay(db: Db, weekStart: string, newDay: string, previousDay: string, originalDay: string | null): Promise<void> {
  await db
    .update(s.planWeeks)
    .set({ day: newDay, rescheduledFrom: originalDay ?? previousDay, updatedAt: new Date() })
    .where(eq(s.planWeeks.weekStart, weekStart));
}

/** Al cambiar el ciclo, la semana en curso y las futuras se vuelven a calcular. */
export async function releaseFrom(db: Db, weekStart: string): Promise<void> {
  await db.delete(s.planWeeks).where(gte(s.planWeeks.weekStart, weekStart));
}
