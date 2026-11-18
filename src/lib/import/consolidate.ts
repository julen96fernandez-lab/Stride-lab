/**
 * Ajustes al final de la importación:
 *  - Distancia pendiente → suma de las muestras de distancia del reloj.
 *  - Entrenamientos de la misma fuente separados por < 2 min → una sola sesión.
 */
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SeriesMetric } from "@/lib/db/schema";

export const MERGE_GAP_S = 120;

/** Para las carreras con distancia «samples_pending», usa la suma de las muestras del reloj. */
export async function resolvePendingDistances(db: Db): Promise<number> {
  const res = await db.execute(sql`
    UPDATE runs r SET
      distance_m = x.total,
      avg_pace_s_per_km = CASE WHEN x.total > 0 THEN r.duration_s / (x.total / 1000) END,
      raw = jsonb_set(r.raw, '{distanceFrom}', '"samples"'),
      updated_at = now()
    FROM (
      SELECT rs.run_id, (SELECT sum(v) FROM unnest(rs.v) v) AS total
      FROM run_series rs WHERE rs.metric = 'distance'
    ) x
    WHERE x.run_id = r.id AND r.raw->>'distanceFrom' = 'samples_pending' AND x.total > 0`);
  return res.rowCount ?? 0;
}

type Run = typeof s.runs.$inferSelect;

function weighted(a: number | null, wa: number, b: number | null, wb: number): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a * wa + b * wb) / (wa + wb);
}
const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

/** Une pares de entrenamientos de la misma fuente separados por menos de MERGE_GAP_S. Devuelve los ids que absorbieron a otro. */
export async function mergeConsecutive(db: Db): Promise<string[]> {
  // Las carreras manuales no se unen nunca (no son del reloj).
  const runs = await db
    .select()
    .from(s.runs)
    .where(and(isNotNull(s.runs.sourceName), ne(s.runs.source, "manual")))
    .orderBy(asc(s.runs.sourceName), asc(s.runs.startAt));
  const merged: string[] = [];
  let i = 0;
  while (i < runs.length - 1) {
    const a = runs[i];
    const b = runs[i + 1];
    const gap = (b.startAt.getTime() - a.endAt.getTime()) / 1000;
    if (a.sourceName !== b.sourceName || gap < 0 || gap >= MERGE_GAP_S) {
      i++;
      continue;
    }
    const joined = await mergePair(db, a, b);
    runs.splice(i, 2, joined);
    merged.push(joined.id);
    // se queda en i: puede haber un tercer bloque seguido
  }
  return merged;
}

async function mergePair(db: Db, a: Run, b: Run): Promise<Run> {
  const offset = Math.round((b.startAt.getTime() - a.startAt.getTime()) / 1000);
  const durationS = a.durationS + b.durationS;
  const distanceM = add(a.distanceM, b.distanceM);
  const steps = add(a.steps, b.steps);
  const rawA = (a.raw ?? {}) as Record<string, unknown>;
  const rawB = (b.raw ?? {}) as Record<string, unknown>;
  const mergedFrom = [...((rawA.mergedFrom as string[]) ?? [a.sourceKey]), b.sourceKey];
  const intervalSteps = [...new Set([...((rawA.intervalSteps as string[]) ?? []), ...((rawB.intervalSteps as string[]) ?? [])])].sort();
  // Pasos de b al reloj de a (las claves repetidas se quedan con la primera aparición).
  type Ev = { key: string; startS: number; durationS: number };
  const evA = (rawA.intervalEvents as Ev[] | undefined) ?? [];
  const evB = ((rawB.intervalEvents as Ev[] | undefined) ?? []).map((e) => ({ ...e, startS: e.startS + offset }));
  const keysA = new Set(evA.map((e) => e.key));
  const intervalEvents = [...evA, ...evB.filter((e) => !keysA.has(e.key))];
  // Pausas: las de b al reloj de a, y el hueco entre las dos partes también es pausa.
  type Pz = { startS: number; endS: number };
  const pauses = [
    ...((rawA.pauses as Pz[] | undefined) ?? []),
    { startS: Math.round((a.endAt.getTime() - a.startAt.getTime()) / 1000), endS: offset },
    ...((rawB.pauses as Pz[] | undefined) ?? []).map((p) => ({ startS: p.startS + offset, endS: p.endS + offset })),
  ].filter((p) => p.endS > p.startS);

  const values = {
    endAt: b.endAt,
    durationS,
    distanceM,
    avgPaceSPerKm: distanceM && distanceM > 0 ? durationS / (distanceM / 1000) : null,
    avgHr: weighted(a.avgHr, a.durationS, b.avgHr, b.durationS),
    maxHr: a.maxHr === null ? b.maxHr : b.maxHr === null ? a.maxHr : Math.max(a.maxHr, b.maxHr),
    avgPowerW: weighted(a.avgPowerW, a.durationS, b.avgPowerW, b.durationS),
    avgSpeedMps: distanceM && durationS ? distanceM / durationS : null,
    avgStrideM: weighted(a.avgStrideM, a.durationS, b.avgStrideM, b.durationS),
    avgVerticalOscCm: weighted(a.avgVerticalOscCm, a.durationS, b.avgVerticalOscCm, b.durationS),
    avgGroundContactMs: weighted(a.avgGroundContactMs, a.durationS, b.avgGroundContactMs, b.durationS),
    steps,
    cadenceSpm: steps !== null && durationS > 0 ? steps / (durationS / 60) : null,
    elevationGainM: add(a.elevationGainM, b.elevationGainM),
    activeEnergyKcal: add(a.activeEnergyKcal, b.activeEnergyKcal),
    routeFile: a.routeFile ?? b.routeFile,
    raw: { ...rawA, intervalSteps, intervalEvents, pauses, mergedFrom, mergedParts: [rawA.attributes, rawB.attributes] },
    updatedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    // Series: las de b se desplazan al reloj de a.
    const series = await tx.select().from(s.runSeries).where(inArray(s.runSeries.runId, [a.id, b.id]));
    const byMetric = new Map<SeriesMetric, { t: number[]; v: number[] }>();
    for (const r of series.sort((x) => (x.runId === a.id ? -1 : 1))) {
      const shift = r.runId === b.id ? offset : 0;
      const m = byMetric.get(r.metric) ?? { t: [], v: [] };
      for (let k = 0; k < r.t.length; k++) {
        m.t.push(r.t[k] + shift);
        m.v.push(r.v[k]);
      }
      byMetric.set(r.metric, m);
    }
    await tx.delete(s.runSeries).where(inArray(s.runSeries.runId, [a.id, b.id]));
    for (const [metric, m] of byMetric) await tx.insert(s.runSeries).values({ runId: a.id, metric, t: m.t, v: m.v });
    // Ruta: se queda la de a; si a no tenía, pasa la de b.
    const routeA = await tx.select({ id: s.runRoutes.runId }).from(s.runRoutes).where(eq(s.runRoutes.runId, a.id));
    if (!routeA.length) await tx.update(s.runRoutes).set({ runId: a.id }).where(eq(s.runRoutes.runId, b.id));
    // El tipo manual de b pasa a a si a no tenía.
    if (!a.sessionTypeManual && b.sessionTypeManual) Object.assign(values, { sessionTypeManual: b.sessionTypeManual });
    await tx.delete(s.runSplits).where(and(eq(s.runSplits.runId, a.id)));
    await tx.update(s.runs).set(values).where(eq(s.runs.id, a.id));
    await tx.delete(s.runs).where(eq(s.runs.id, b.id));
  });
  return { ...a, ...values } as Run;
}
