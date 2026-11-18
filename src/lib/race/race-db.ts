import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { RaceInput, RaceProfile } from "./race";

export type RaceRow = typeof s.raceGoals.$inferSelect;

export async function listRaces(db: Db): Promise<RaceRow[]> {
  return db.select().from(s.raceGoals).orderBy(asc(s.raceGoals.date));
}

export async function getRace(db: Db, id: string): Promise<RaceRow | null> {
  return (await db.select().from(s.raceGoals).where(eq(s.raceGoals.id, id)).limit(1))[0] ?? null;
}

/** Crea o edita. `profile`: undefined = no tocar; null = quitar. */
export async function saveRace(db: Db, input: RaceInput, o: { id?: string | null; profile?: RaceProfile | null } = {}): Promise<string> {
  const values = { ...input, ...(o.profile !== undefined ? { profile: o.profile } : {}), updatedAt: new Date() };
  if (o.id) {
    await db.update(s.raceGoals).set(values).where(eq(s.raceGoals.id, o.id));
    return o.id;
  }
  const [row] = await db.insert(s.raceGoals).values(values).returning({ id: s.raceGoals.id });
  return row.id;
}

export async function deleteRace(db: Db, id: string): Promise<void> {
  await db.delete(s.raceGoals).where(eq(s.raceGoals.id, id));
}

/** Vincula la carrera real a la carrera objetivo (y, si se pide, la marca como Competición). */
export async function linkRun(db: Db, raceId: string, runId: string, markCompetition: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(s.raceGoals).set({ runId, updatedAt: new Date() }).where(eq(s.raceGoals.id, raceId));
    if (markCompetition) await tx.update(s.runs).set({ sessionTypeManual: "competicion", updatedAt: new Date() }).where(eq(s.runs.id, runId));
  });
}

/** Quita el vínculo (el tipo de la carrera se queda como esté). */
export async function unlinkRun(db: Db, raceId: string): Promise<void> {
  await db.update(s.raceGoals).set({ runId: null, updatedAt: new Date() }).where(eq(s.raceGoals.id, raceId));
}
