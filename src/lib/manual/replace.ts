import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { matchManualRuns } from "./manual";
import { moveFeeling } from "@/lib/feelings/feelings-db";

/**
 * Al importar el zip: cada manual con pareja en el zip (mismo día, inicio a < 30 min y
 * distancia ±5 %) se sustituye por ella. La del zip conserva el tipo elegido a mano, la nota y
 * el calzado de la manual. Las manuales sin pareja se quedan como están.
 */
export async function replaceManualRuns(db: Db): Promise<number> {
  const all = await db
    .select({ id: s.runs.id, source: s.runs.source, startAt: s.runs.startAt, distanceM: s.runs.distanceM, sessionTypeManual: s.runs.sessionTypeManual, note: s.runs.note, shoeId: s.runs.shoeId })
    .from(s.runs);
  const manual = all.filter((r) => r.source === "manual");
  if (!manual.length) return 0;
  // Primero contra el Apple Watch (las demás fuentes del zip suelen ser copias suyas, que luego
  // se marcan como duplicadas); las manuales que no encuentren pareja ahí, contra el resto.
  const zip = all.filter((r) => r.source !== "manual");
  const watch = zip.filter((r) => r.source === "apple_watch");
  const pairs = matchManualRuns(manual, watch);
  const rest = matchManualRuns(
    manual.filter((m) => !pairs.has(m.id)),
    zip.filter((r) => r.source !== "apple_watch"),
  );
  for (const [k, v] of rest) pairs.set(k, v);
  for (const [mId, zId] of pairs) {
    const m = manual.find((r) => r.id === mId)!;
    const z = zip.find((r) => r.id === zId)!;
    await db.transaction(async (tx) => {
      await tx
        .update(s.runs)
        .set({
          sessionTypeManual: m.sessionTypeManual ?? z.sessionTypeManual,
          note: m.note ?? z.note,
          shoeId: m.shoeId ?? z.shoeId,
          updatedAt: new Date(),
        })
        .where(eq(s.runs.id, zId));
    });
    // La sensación de la manual pasa a la del zip (antes de borrar la manual: borrarla la arrastra).
    await moveFeeling(db, mId, zId);
    await db.delete(s.runs).where(eq(s.runs.id, mId));
  }
  return pairs.size;
}
