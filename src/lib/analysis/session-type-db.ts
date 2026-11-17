import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { DEFAULT_TYPE_SETTINGS, classifySessionTypes, type SessionType, type TypeSettings } from "./session-type";

const SETTINGS_KEY = "session_type_settings";

export async function getTypeSettings(db: Db): Promise<TypeSettings> {
  const rows = await db.select().from(s.appSettings).where(eq(s.appSettings.key, SETTINGS_KEY)).limit(1);
  if (!rows[0]) return DEFAULT_TYPE_SETTINGS;
  try {
    const v = JSON.parse(rows[0].value) as Partial<TypeSettings>;
    return { ...DEFAULT_TYPE_SETTINGS, ...v };
  } catch {
    return DEFAULT_TYPE_SETTINGS;
  }
}

export async function saveTypeSettings(db: Db, v: TypeSettings): Promise<void> {
  const value = JSON.stringify(v);
  await db
    .insert(s.appSettings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: s.appSettings.key, set: { value, updatedAt: sql`now()` } });
}

/** Recalcula el tipo automático de todas las carreras válidas (no toca el manual). */
export async function reclassifyAll(db: Db): Promise<number> {
  const settings = await getTypeSettings(db);
  const rows = await db
    .select({
      id: s.runs.id,
      startAt: s.runs.startAt,
      distanceM: s.runs.distanceM,
      avgPaceSPerKm: s.runs.avgPaceSPerKm,
      avgHr: s.runs.avgHr,
      isIndoor: s.runs.isIndoor,
      isSpecial: s.runs.isSpecial,
      elevationGainM: s.runs.elevationGainM,
      intervalSteps: sql<string[] | null>`${s.runs.raw}->'intervalSteps'`,
    })
    .from(s.runs)
    .where(eq(s.runs.status, "valid"));
  const res = classifySessionTypes(rows, settings);
  const ids = [...res.keys()];
  if (ids.length) {
    await db.execute(sql`
      UPDATE runs SET session_type_auto = x.t, session_type_reason = x.r
      FROM (SELECT * FROM unnest(${sql.param(ids)}::uuid[], ${sql.param(ids.map((i) => res.get(i)!.type))}::text[],
                                 ${sql.param(ids.map((i) => res.get(i)!.reason))}::text[]) AS t(id, t, r)) x
      WHERE runs.id = x.id`);
  }
  // Las no válidas no llevan tipo automático.
  await db.execute(sql`UPDATE runs SET session_type_auto = NULL, session_type_reason = NULL WHERE status <> 'valid' AND session_type_auto IS NOT NULL`);
  return ids.length;
}

/** Si hay carreras válidas sin tipo automático (p. ej. importadas antes de existir), las clasifica. */
export async function ensureClassified(db: Db): Promise<void> {
  const pending = await db
    .select({ id: s.runs.id })
    .from(s.runs)
    .where(and(eq(s.runs.status, "valid"), isNull(s.runs.sessionTypeAuto)))
    .limit(1);
  if (pending.length) await reclassifyAll(db);
}

export async function setManualType(db: Db, runId: string, type: SessionType | null): Promise<void> {
  await db.update(s.runs).set({ sessionTypeManual: type, updatedAt: new Date() }).where(eq(s.runs.id, runId));
}

/** SQL del tipo efectivo: el manual manda sobre el automático. */
export const effectiveType = sql<string | null>`coalesce(${s.runs.sessionTypeManual}, ${s.runs.sessionTypeAuto})`;
