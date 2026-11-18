import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { isEmptyFeeling, type Feeling, type FeelingTag } from "./feelings";

export async function getFeeling(db: Db, runId: string): Promise<Feeling | null> {
  const r = (await db.select().from(s.runFeelings).where(eq(s.runFeelings.runId, runId)).limit(1))[0];
  return r ? { rating: r.rating, note: r.note, tags: (r.tags ?? []) as FeelingTag[] } : null;
}

/** Guarda (o borra, si queda vacía) la sensación de una carrera. */
export async function saveFeeling(db: Db, runId: string, f: Feeling): Promise<"saved" | "deleted"> {
  if (isEmptyFeeling(f)) {
    await deleteFeeling(db, runId);
    return "deleted";
  }
  const values = { rating: f.rating, note: f.note, tags: f.tags, updatedAt: new Date() };
  await db.insert(s.runFeelings).values({ runId, ...values }).onConflictDoUpdate({ target: s.runFeelings.runId, set: values });
  return "saved";
}

export async function deleteFeeling(db: Db, runId: string): Promise<void> {
  await db.delete(s.runFeelings).where(eq(s.runFeelings.runId, runId));
}

/**
 * Al sustituir una carrera manual por la del zip: la sensación pasa a la del zip (si esta no
 * tenía ya una propia).
 */
export async function moveFeeling(db: Db, fromRunId: string, toRunId: string): Promise<void> {
  const [from, to] = await Promise.all([getFeeling(db, fromRunId), getFeeling(db, toRunId)]);
  if (from && !to) await db.update(s.runFeelings).set({ runId: toRunId, updatedAt: new Date() }).where(eq(s.runFeelings.runId, fromRunId));
}
