import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { applyInjuryFlags } from "./injuries-db";
import { recomputeEfficiency } from "./efficiency-db";
import { recomputeEfforts } from "./efforts-db";
import { DEFAULT_ZONES, estimatedLoad, timeInZones, trainingLoad, validZones, type HrZones } from "./hr-zones";
import { DEFAULT_TYPE_SETTINGS, classifySessionTypes, type RunForType, type SessionType, type TypeSettings } from "./session-type";

const SETTINGS_KEY = "session_type_settings";
const ZONES_KEY = "hr_zones";

async function readJson<T>(db: Db, key: string): Promise<Partial<T> | null> {
  const rows = await db.select().from(s.appSettings).where(eq(s.appSettings.key, key)).limit(1);
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].value) as Partial<T>;
  } catch {
    return null;
  }
}

async function writeJson(db: Db, key: string, v: unknown) {
  const value = JSON.stringify(v);
  await db
    .insert(s.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.appSettings.key, set: { value, updatedAt: sql`now()` } });
}

export async function getTypeSettings(db: Db): Promise<TypeSettings> {
  return { ...DEFAULT_TYPE_SETTINGS, ...((await readJson<TypeSettings>(db, SETTINGS_KEY)) ?? {}) };
}

export async function saveTypeSettings(db: Db, v: TypeSettings): Promise<void> {
  await writeJson(db, SETTINGS_KEY, v);
}

export async function getZones(db: Db): Promise<HrZones> {
  const z = { ...DEFAULT_ZONES, ...((await readJson<HrZones>(db, ZONES_KEY)) ?? {}) } as HrZones;
  return validZones(z) ? z : DEFAULT_ZONES;
}

export async function saveZones(db: Db, z: HrZones): Promise<void> {
  if (!validZones(z)) throw new Error("Zonas no válidas");
  await writeJson(db, ZONES_KEY, z);
}

/**
 * Recalcula todo lo que depende de los ajustes, para todas las carreras válidas:
 * tiempo en zonas, carga y tipo automático. El tipo manual no se toca.
 */
export async function reclassifyAll(db: Db, opts: { efforts?: boolean } = {}): Promise<number> {
  await applyInjuryFlags(db);
  // Los mejores esfuerzos no dependen de lesiones ni zonas: se pueden saltar al guardar una lesión.
  if (opts.efforts !== false) await recomputeEfforts(db);
  const [settings, zones] = await Promise.all([getTypeSettings(db), getZones(db)]);
  // Ritmo en Z2 (eficiencia aeróbica): depende de las zonas, por eso va aquí.
  if (opts.efforts !== false) await recomputeEfficiency(db, zones);
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
      inInjury: s.runs.inInjury,
      durationS: s.runs.durationS,
      loadEstimated: s.runs.loadEstimated,
    })
    .from(s.runs)
    .where(eq(s.runs.status, "valid"));

  // Tiempo en zonas y carga con las muestras de FC ya guardadas.
  const hrSeries = await db
    .select({ runId: s.runSeries.runId, t: s.runSeries.t, v: s.runSeries.v })
    .from(s.runSeries)
    .innerJoin(s.runs, and(eq(s.runs.id, s.runSeries.runId), eq(s.runs.status, "valid")))
    .where(eq(s.runSeries.metric, "hr"));
  const zoneSecs = new Map(hrSeries.map((h) => [h.runId, timeInZones(h.t, h.v, zones.limits)]));

  const res = classifySessionTypes(rows, settings, zones);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    // Las zonas viajan como texto "{a,b,c,d,e}" para no anidar arrays en unnest.
    const zs = ids.map((i) => {
      const z = zoneSecs.get(i);
      return z ? `{${z.map((x) => Math.round(x)).join(",")}}` : null;
    });
    // Sin muestras de pulso, una carrera manual conserva su carga estimada (con las zonas actuales).
    const byId = new Map(rows.map((r) => [r.id, r]));
    const loads = ids.map((i) => {
      const z = zoneSecs.get(i);
      if (z) return trainingLoad(z);
      const r = byId.get(i)!;
      return r.loadEstimated ? estimatedLoad(r.avgHr, r.durationS, zones.limits) : null;
    });
    await db.execute(sql`
      UPDATE runs SET
        session_type_auto = x.t,
        session_type_reason = x.r,
        hr_zone_seconds = x.z::real[],
        training_load = x.l
      FROM (SELECT * FROM unnest(
        ${sql.param(ids)}::uuid[],
        ${sql.param(ids.map((i) => res.get(i)!.type))}::text[],
        ${sql.param(ids.map((i) => res.get(i)!.reason))}::text[],
        ${sql.param(zs)}::text[],
        ${sql.param(loads)}::real[]
      ) AS t(id, t, r, z, l)) x
      WHERE runs.id = x.id`);
  }
  // Las no válidas no llevan tipo automático.
  await db.execute(sql`UPDATE runs SET session_type_auto = NULL, session_type_reason = NULL WHERE status <> 'valid' AND session_type_auto IS NOT NULL`);
  return ids.length;
}

/**
 * Tipo automático de una sola carrera (nueva o editada) con las mismas reglas, zonas y media
 * de referencia de 12 meses que el resto, sin tocar las demás.
 */
export async function classifyCandidate(db: Db, candidate: RunForType): Promise<{ type: SessionType; reason: string }> {
  const [settings, zones] = await Promise.all([getTypeSettings(db), getZones(db)]);
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
      inInjury: s.runs.inInjury,
    })
    .from(s.runs)
    .where(eq(s.runs.status, "valid"));
  const all = [...rows.filter((r) => r.id !== candidate.id), candidate];
  return classifySessionTypes(all, settings, zones).get(candidate.id)!;
}

/**
 * Versión de las reglas. Al cambiar las reglas se sube este número y, la próxima vez
 * que se abra una pantalla, todo se recalcula una vez.
 * 3 = Series por rutas de paso con repetición + tipos por zona de FC + carga.
 */
const CLASSIFIER_VERSION = "9"; // 9 = ritmo en Z2 por carrera (eficiencia aeróbica)
const VERSION_KEY = "classifier_version";

/** Recalcula si las reglas cambiaron o si hay carreras válidas sin tipo automático. */
export async function ensureClassified(db: Db): Promise<void> {
  const [ver, pending] = await Promise.all([
    db.select().from(s.appSettings).where(eq(s.appSettings.key, VERSION_KEY)).limit(1),
    db
      .select({ id: s.runs.id })
      .from(s.runs)
      .where(and(eq(s.runs.status, "valid"), isNull(s.runs.sessionTypeAuto)))
      .limit(1),
  ]);
  if (ver[0]?.value === CLASSIFIER_VERSION && pending.length === 0) return;
  await reclassifyAll(db);
  await db
    .insert(s.appSettings)
    .values({ key: VERSION_KEY, value: CLASSIFIER_VERSION })
    .onConflictDoUpdate({ target: s.appSettings.key, set: { value: CLASSIFIER_VERSION, updatedAt: sql`now()` } });
}

export async function setManualType(db: Db, runId: string, type: SessionType | null): Promise<void> {
  await db.update(s.runs).set({ sessionTypeManual: type, updatedAt: new Date() }).where(eq(s.runs.id, runId));
}

/** SQL del tipo efectivo: el manual manda sobre el automático. */
export const effectiveType = sql<string | null>`coalesce(${s.runs.sessionTypeManual}, ${s.runs.sessionTypeAuto})`;
