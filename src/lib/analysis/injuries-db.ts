import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export type Injury = typeof s.injuries.$inferSelect;

export async function listInjuries(db: Db): Promise<Injury[]> {
  return db.select().from(s.injuries).orderBy(desc(s.injuries.startDate), asc(s.injuries.createdAt));
}

/**
 * Marca `in_injury` en todas las carreras según los periodos (fechas en hora de Madrid;
 * sin fecha de fin = sigue abierto). Las carreras no se borran ni se ocultan.
 */
export async function applyInjuryFlags(db: Db): Promise<void> {
  await db.execute(sql`
    UPDATE runs r SET in_injury = EXISTS (
      SELECT 1 FROM injuries i
      WHERE (r.start_at AT TIME ZONE 'Europe/Madrid')::date >= i.start_date
        AND (i.end_date IS NULL OR (r.start_at AT TIME ZONE 'Europe/Madrid')::date <= i.end_date)
    )
    WHERE in_injury IS DISTINCT FROM EXISTS (
      SELECT 1 FROM injuries i
      WHERE (r.start_at AT TIME ZONE 'Europe/Madrid')::date >= i.start_date
        AND (i.end_date IS NULL OR (r.start_at AT TIME ZONE 'Europe/Madrid')::date <= i.end_date)
    )`);
}

export async function saveInjury(
  db: Db,
  v: { id?: string | null; startDate: string; endDate: string | null; note: string | null },
): Promise<void> {
  if (v.id) {
    await db.update(s.injuries).set({ startDate: v.startDate, endDate: v.endDate, note: v.note }).where(eq(s.injuries.id, v.id));
  } else {
    await db.insert(s.injuries).values({ startDate: v.startDate, endDate: v.endDate, note: v.note });
  }
  await applyInjuryFlags(db);
}

export async function deleteInjury(db: Db, id: string): Promise<void> {
  await db.delete(s.injuries).where(eq(s.injuries.id, id));
  await applyInjuryFlags(db);
}
