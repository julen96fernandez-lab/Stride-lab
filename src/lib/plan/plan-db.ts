import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { WeekSession } from "./weekly";
import type { MineInput } from "./mine";

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

/** Quita la sugerencia de una semana (la congela si aún no lo estaba). */
export async function dismissWeek(db: Db, w: WeekSession): Promise<void> {
  await db
    .insert(s.planWeeks)
    .values({ weekStart: w.start, shiftKind: w.kind, session: w.session, day: w.day, whenText: w.when, reason: w.reason, downgraded: w.downgraded, dismissed: true })
    .onConflictDoUpdate({ target: s.planWeeks.weekStart, set: { dismissed: true, updatedAt: new Date() } });
}

/** Recupera la sugerencia quitada. Si la semana es futura, se borra para que se recalcule. */
export async function restoreWeek(db: Db, weekStart: string, currentWeek: string): Promise<void> {
  if (weekStart > currentWeek) await db.delete(s.planWeeks).where(eq(s.planWeeks.weekStart, weekStart));
  else await db.update(s.planWeeks).set({ dismissed: false, updatedAt: new Date() }).where(eq(s.planWeeks.weekStart, weekStart));
}

// ─── Sesiones puestas por mí ────────────────────────────────────────────────

export type MineRow = typeof s.plannedSessions.$inferSelect;

export async function listMine(db: Db, from: string, to: string): Promise<MineRow[]> {
  return db
    .select()
    .from(s.plannedSessions)
    .where(and(gte(s.plannedSessions.date, from), lte(s.plannedSessions.date, to)))
    .orderBy(asc(s.plannedSessions.date), asc(s.plannedSessions.createdAt));
}

export async function getMine(db: Db, id: string): Promise<MineRow | null> {
  return (await db.select().from(s.plannedSessions).where(eq(s.plannedSessions.id, id)).limit(1))[0] ?? null;
}

/** Crea o edita. Al editar se conserva la semana que sustituye. */
export async function saveMine(db: Db, input: MineInput, id?: string | null): Promise<string> {
  if (id) {
    const { replacesWeek: _keep, ...rest } = input;
    void _keep;
    await db.update(s.plannedSessions).set({ ...rest, updatedAt: new Date() }).where(eq(s.plannedSessions.id, id));
    return id;
  }
  const [row] = await db.insert(s.plannedSessions).values(input).returning({ id: s.plannedSessions.id });
  return row.id;
}

/** Borra la sesión; si sustituía a una sugerencia, la sugerencia vuelve. */
export async function deleteMine(db: Db, id: string): Promise<void> {
  await db.delete(s.plannedSessions).where(eq(s.plannedSessions.id, id));
}
