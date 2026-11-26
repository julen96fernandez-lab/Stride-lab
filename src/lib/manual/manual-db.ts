/**
 * Carreras manuales en la base de datos. Al guardar se recalcula solo esa carrera (tipo,
 * parciales, zonas, carga, récords y ritmo en Z2); objetivos y gráficos se calculan al vuelo.
 */
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { bestEfforts } from "@/lib/analysis/best-efforts";
import { paceInHrBand, z2Band } from "@/lib/analysis/efficiency";
import { runLoad, timeInZones } from "@/lib/analysis/hr-zones";
import { buildStream, reduceTrack } from "@/lib/analysis/run-stream";
import { classifyCandidate, getZones } from "@/lib/analysis/session-type-db";
import { applyInjuryFlags } from "@/lib/analysis/injuries-db";
import { fileSeries, parseActivityFile, toGpx, type ActivityFile } from "@/lib/import/activity-file";
import { bbox, cumulativeDistance, elevationGainLoss, encodePolyline, simplify } from "@/lib/import/gpx";
import { writeSplits } from "@/lib/import/pipeline";
import { DUPLICATE_WARN_MS, manualDerived, type ManualInput } from "./manual";
export { replaceManualRuns } from "./replace";

export interface ManualDeps {
  db: Db;
  /** Guarda el GPX de la ruta (Blob privado en producción). */
  putRoute: (pathname: string, body: Buffer) => Promise<string>;
}

export interface DuplicateHint {
  id: string;
  startAt: Date;
  distanceM: number | null;
  source: string;
}

/** Otras carreras que empiezan a ≤ 30 min (para avisar antes de guardar). */
export async function findDuplicates(db: Db, startAt: Date, excludeId?: string | null): Promise<DuplicateHint[]> {
  const from = new Date(startAt.getTime() - DUPLICATE_WARN_MS);
  const to = new Date(startAt.getTime() + DUPLICATE_WARN_MS);
  return db
    .select({ id: s.runs.id, startAt: s.runs.startAt, distanceM: s.runs.distanceM, source: s.runs.source })
    .from(s.runs)
    .where(and(eq(s.runs.status, "valid"), gte(s.runs.startAt, from), lte(s.runs.startAt, to), excludeId ? ne(s.runs.id, excludeId) : sql`true`));
}

export interface ManualPreview {
  paceSPerKm: number;
  isSpecial: boolean;
  status: "valid" | "invalid";
  type: string;
  typeReason: string;
  typeIsManual: boolean;
  load: number | null;
  loadEstimated: boolean;
  duplicates: DuplicateHint[];
  file: { kind: string; points: number; hasGps: boolean; hasHr: boolean; hasPower: boolean } | null;
}

function parseFile(file: { name: string; bytes: Uint8Array } | null | undefined): ActivityFile | null {
  return file ? parseActivityFile(file.name, file.bytes) : null;
}

/** Lo que saldría al guardar: ritmo, especial, tipo, carga y posibles duplicados. */
export async function previewManual(db: Db, input: ManualInput, file?: { name: string; bytes: Uint8Array } | null, editId?: string | null): Promise<ManualPreview> {
  const parsed = parseFile(file);
  const d = manualDerived(input);
  const zones = await getZones(db);
  const series = parsed ? fileSeries(parsed.points, input.startAt.getTime()) : null;
  const auto = await classifyCandidate(db, candidateFor(editId ?? "preview", input, d));
  const rl = runLoad({
    zoneSeconds: series?.hr ? timeInZones(series.hr.t, series.hr.v, zones.limits) : null,
    durationS: input.durationS,
    avgHr: input.avgHr,
    hrSamples: series?.hr?.v,
    limits: zones.limits,
  });
  return {
    paceSPerKm: d.paceSPerKm,
    isSpecial: d.isSpecial,
    status: d.status,
    type: input.sessionType ?? auto.type,
    typeReason: input.sessionType ? "Elegido a mano" : auto.reason,
    typeIsManual: !!input.sessionType,
    load: rl.load,
    loadEstimated: rl.quality === "estimated",
    duplicates: await findDuplicates(db, input.startAt, editId),
    file: parsed
      ? { kind: parsed.kind, points: parsed.points.length, hasGps: parsed.summary.hasGps, hasHr: !!series?.hr, hasPower: !!series?.power }
      : null,
  };
}

function candidateFor(id: string, input: ManualInput, d: ReturnType<typeof manualDerived>) {
  return {
    id,
    startAt: input.startAt,
    distanceM: input.distanceM,
    avgPaceSPerKm: d.paceSPerKm,
    avgHr: input.avgHr,
    isIndoor: input.isIndoor,
    isSpecial: d.isSpecial,
    elevationGainM: input.elevationGainM,
    intervalSteps: null,
    inInjury: false,
  };
}

/**
 * Crea o edita una carrera manual. Con archivo, se guardan sus series, ruta y pista (y se
 * sustituyen las anteriores); `removeFile` borra los datos de un archivo anterior.
 */
export async function saveManualRun(
  deps: ManualDeps,
  input: ManualInput,
  opts: { id?: string | null; file?: { name: string; bytes: Uint8Array } | null; removeFile?: boolean } = {},
): Promise<string> {
  const { db } = deps;
  const parsed = parseFile(opts.file);
  const d = manualDerived(input);
  const zones = await getZones(db);

  if (opts.id) {
    const cur = (await db.select({ source: s.runs.source }).from(s.runs).where(eq(s.runs.id, opts.id)))[0];
    if (!cur) throw new Error("La carrera no existe.");
    if (cur.source !== "manual") throw new Error("Solo se pueden editar las carreras añadidas a mano.");
  }

  const base = {
    startAt: input.startAt,
    endAt: new Date(input.startAt.getTime() + input.durationS * 1000),
    durationS: input.durationS,
    distanceM: input.distanceM,
    avgPaceSPerKm: d.paceSPerKm,
    avgSpeedMps: input.distanceM / input.durationS,
    avgHr: input.avgHr,
    maxHr: input.maxHr,
    avgPowerW: input.avgPowerW,
    cadenceSpm: input.cadenceSpm,
    elevationGainM: input.elevationGainM,
    temperatureC: input.temperatureC,
    isIndoor: input.isIndoor,
    isSpecial: d.isSpecial,
    status: d.status,
    invalidReason: d.invalidReason,
    sessionTypeManual: input.sessionType,
    updatedAt: new Date(),
  } as const;

  let id = opts.id ?? null;
  if (id) {
    await db.update(s.runs).set(base).where(eq(s.runs.id, id));
  } else {
    id = crypto.randomUUID();
    await db.insert(s.runs).values({
      ...base,
      id,
      sourceKey: `manual|${id}`,
      source: "manual",
      sourceName: "Manual",
      raw: { manual: true },
    });
  }

  // Datos de archivo: se sustituyen si hay uno nuevo o si se pide quitarlos.
  if (parsed || opts.removeFile) {
    await db.delete(s.runSeries).where(eq(s.runSeries.runId, id));
    await db.delete(s.runRoutes).where(eq(s.runRoutes.runId, id));
    await db.delete(s.runTracks).where(eq(s.runTracks.runId, id));
    await db.delete(s.runSplits).where(eq(s.runSplits.runId, id));
    await db.update(s.runs).set({ routeFile: null, raw: { manual: true } }).where(eq(s.runs.id, id));
  }
  if (parsed) await storeFileData(deps, { id, startAt: input.startAt }, parsed, opts.file!.name);

  await recomputeOne(db, id, input, d, zones);
  return id;
}

async function storeFileData(deps: ManualDeps, run: { id: string; startAt: Date }, f: ActivityFile, fileName: string) {
  const { db } = deps;
  const start = run.startAt.getTime();
  const sr = fileSeries(f.points, start);
  const rows = (
    [
      ["distance", sr.distance],
      ["hr", sr.hr],
      ["power", sr.power],
    ] as const
  )
    .filter(([, v]) => v && v.t.length > 1)
    .map(([metric, v]) => ({ runId: run.id, metric, t: v!.t, v: v!.v }));
  if (rows.length) await db.insert(s.runSeries).values(rows);

  const gps = f.points.filter((p) => p.lat !== null && p.lon !== null);
  let gpxPts: { lat: number; lon: number; ele: number | null; time: number | null }[] | null = null;
  if (gps.length > 1) {
    gpxPts = gps.map((p) => ({ lat: p.lat!, lon: p.lon!, ele: p.ele, time: p.t }));
    const url = await deps.putRoute(`routes/${run.id}.gpx`, Buffer.from(toGpx(gps)));
    const cum = cumulativeDistance(gpxPts);
    const { gain } = elevationGainLoss(gpxPts.map((p) => p.ele));
    await db.insert(s.runRoutes).values({
      runId: run.id,
      blobUrl: url,
      fileName,
      pointCount: gpxPts.length,
      polyline: encodePolyline(simplify(gpxPts, 4)),
      ...bbox(gpxPts),
      gpxDistanceM: cum[cum.length - 1],
      gpxElevationGainM: gpxPts.some((p) => p.ele !== null) ? gain : null,
    });
    const track = reduceTrack(gpxPts, start, 2);
    if (track) {
      await db.insert(s.runTracks).values({
        runId: run.id,
        t: track.t,
        lat: track.lat,
        lon: track.lon,
        ele: track.ele.some((e) => e !== null) ? (track.ele as number[]) : null,
      });
    }
  }
  await db.update(s.runs).set({ routeFile: fileName, raw: { manual: true, file: { name: fileName, kind: f.kind, points: f.points.length } } }).where(eq(s.runs.id, run.id));
  // Parciales: con la distancia del archivo y la altitud del GPS.
  await writeSplits(db, run, gpxPts);
}

/** Recalcula solo esta carrera: tipo, zonas, carga, récords y ritmo en Z2. */
async function recomputeOne(db: Db, id: string, input: ManualInput, d: ReturnType<typeof manualDerived>, zones: Awaited<ReturnType<typeof getZones>>) {
  const series = await db.select().from(s.runSeries).where(eq(s.runSeries.runId, id));
  const by = Object.fromEntries(series.map((r) => [r.metric, { t: r.t, v: r.v }])) as Partial<Record<s.SeriesMetric, { t: number[]; v: number[] }>>;

  const auto = d.status === "valid" ? await classifyCandidate(db, candidateFor(id, input, d)) : null;
  const zoneSecs = by.hr ? timeInZones(by.hr.t, by.hr.v, zones.limits) : null;
  const rl = runLoad({ zoneSeconds: zoneSecs, durationS: input.durationS, avgHr: input.avgHr, hrSamples: by.hr?.v, limits: zones.limits });

  let ef: { paceSPerKm: number; seconds: number } | null = null;
  if (by.distance && by.hr) {
    const st = buildStream({ durationS: input.durationS, distance: by.distance, hr: by.hr });
    ef = paceInHrBand(st.pace, st.hr, st.t.length > 1 ? st.t[1] - st.t[0] : 3, z2Band(zones.limits));
  }
  await db
    .update(s.runs)
    .set({
      sessionTypeAuto: auto?.type ?? null,
      sessionTypeReason: auto?.reason ?? null,
      hrZoneSeconds: zoneSecs,
      trainingLoad: rl.load,
      loadEstimated: rl.quality === "estimated",
      efZ2PaceSPerKm: ef?.paceSPerKm ?? null,
      efZ2Seconds: ef?.seconds ?? null,
    })
    .where(eq(s.runs.id, id));

  // Récords de esta carrera, con las mismas reglas de muestras válidas.
  await db.delete(s.runEfforts).where(eq(s.runEfforts.runId, id));
  if (by.distance && d.status === "valid") {
    const eff = bestEfforts(by.distance.t, by.distance.v);
    if (eff.length) await db.insert(s.runEfforts).values(eff.map((e) => ({ runId: id, key: e.key, distanceM: e.distanceM, timeS: e.timeS, startS: e.startS, maxGapS: e.maxGapS })));
  }
  await applyInjuryFlags(db);
}

/** Borra una carrera manual (las importadas del zip no se pueden borrar). */
export async function deleteManualRun(db: Db, id: string): Promise<boolean> {
  const res = await db.delete(s.runs).where(and(eq(s.runs.id, id), eq(s.runs.source, "manual"))).returning({ id: s.runs.id });
  return res.length > 0;
}

