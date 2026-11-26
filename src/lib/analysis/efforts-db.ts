import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { bestEfforts } from "./best-efforts";

/**
 * Recalcula los mejores esfuerzos de todas las carreras válidas a partir de las muestras
 * de distancia del reloj (tramos continuos). Las carreras sin muestras no tienen esfuerzos.
 */
export async function recomputeEfforts(db: Db): Promise<number> {
  const rows = await db
    .select({ runId: s.runSeries.runId, t: s.runSeries.t, v: s.runSeries.v })
    .from(s.runSeries)
    .innerJoin(s.runs, and(eq(s.runs.id, s.runSeries.runId), eq(s.runs.status, "valid")))
    .where(eq(s.runSeries.metric, "distance"));
  const values = rows.flatMap((r) => bestEfforts(r.t, r.v).map((e) => ({ runId: r.runId, key: e.key, distanceM: e.distanceM, timeS: e.timeS, startS: e.startS, maxGapS: e.maxGapS })));
  await db.transaction(async (tx) => {
    await tx.delete(s.runEfforts);
    for (let i = 0; i < values.length; i += 500) await tx.insert(s.runEfforts).values(values.slice(i, i + 500));
  });
  return values.length;
}

export async function deleteEffortsFor(db: Db, runIds: string[]): Promise<void> {
  if (runIds.length) await db.delete(s.runEfforts).where(inArray(s.runEfforts.runId, runIds));
}
