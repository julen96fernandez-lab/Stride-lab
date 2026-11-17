/**
 * Importador reanudable de Apple Health.
 *
 * Cada llamada a `runImportStep` trabaja hasta `deadline` y guarda un punto de
 * control en `imports.state`. Fases:
 *   index    → lee el directorio central del zip (por rangos)
 *   workouts → 1.ª pasada por export.xml: carreras, VO₂ máx. y fecha del export
 *   samples  → 2.ª pasada: FC, potencia, velocidad y distancia dentro de cada carrera
 *   series   → fusiona las muestras en run_series
 *   routes   → GPX: original a Blob, ruta simplificada y parciales
 *   finalize → parciales sin GPX, deduplicado y clasificación
 * Las pasadas por el XML guardan el byte del XML descomprimido por el que van; al
 * reanudar se vuelve a descomprimir desde el principio y se salta hasta ese byte
 * (descomprimir es mucho más rápido que analizar).
 */
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { ImportPhase, SeriesMetric } from "@/lib/db/schema";
import { classifyRuns } from "./classify";
import { reclassifyAll } from "@/lib/analysis/session-type-db";
import { bbox, cumulativeDistance, elevationGainLoss, encodePolyline, parseGpx, simplify, type GpxPoint } from "./gpx";
import { XmlScanner, type ScanTarget } from "./scanner";
import { computeSplits, cumulativeFromIntervals, type Series } from "./splits";
import { toMeters, toMps, toNumber } from "./units";
import { parseRunningWorkout, parseVo2Record, workoutActivityType, RUNNING, type ParsedRun } from "./workout";
import { attr, parseHealthDate } from "./xml";
import { entryDataStart, openEntryStream, readCentralDirectory, readSmallEntry, type RangeSource, type ZipEntry } from "./zip";

export interface ImportDeps {
  db: Db;
  source: RangeSource;
  /** Guarda un GPX original y devuelve su URL. */
  putRoute: (pathname: string, body: Buffer) => Promise<string>;
  now?: () => number;
}

type CompactEntry = [lho: number, csize: number, usize: number, method: number];

interface State {
  xml?: { name: string; entry: CompactEntry; dataStart: number };
  gpx?: Record<string, CompactEntry>;
  offset?: number;
  seq?: number;
  routeSkipped?: string[];
  unrefIdx?: number;
  splitsTried?: string[];
}

const CHECKPOINT_MS = 30_000;
const Q = "HKQuantityTypeIdentifier";

const toEntry = (name: string, c: CompactEntry): ZipEntry => ({
  name,
  localHeaderOffset: c[0],
  compressedSize: c[1],
  uncompressedSize: c[2],
  method: c[3],
});
const basename = (p: string) => p.split("/").pop() ?? p;

type ImportRow = typeof s.imports.$inferSelect;

export async function runImportStep(importId: string, deps: ImportDeps, deadline: number): Promise<ImportRow> {
  const now = deps.now ?? Date.now;
  const { db } = deps;
  let row = await getImport(db, importId);
  if (row.status === "done") return row;

  // Reserva: solo una invocación a la vez (la reserva caduca sola si la función muere).
  const claimed = await db
    .update(s.imports)
    .set({
      status: "processing",
      error: null,
      startedAt: row.startedAt ?? new Date(),
      leaseUntil: sql`now() + interval '330 seconds'`, // > maxDuration de la función
      updatedAt: new Date(),
    })
    .where(and(eq(s.imports.id, importId), sql`(${s.imports.leaseUntil} IS NULL OR ${s.imports.leaseUntil} < now())`))
    .returning({ id: s.imports.id });
  if (claimed.length === 0) return row; // otra invocación está trabajando

  try {
    // Al menos una fase por invocación; luego, mientras quede tiempo.
    for (let first = true; first || now() < deadline; first = false) {
      row = await getImport(db, importId);
      const phase = row.phase;
      if (phase === "done") break;
      const handler = HANDLERS[phase];
      const finished = await handler(row, deps, deadline);
      if (!finished) break; // se acabó el tiempo a mitad de fase
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(s.imports)
      .set({ status: "failed", error: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(s.imports.id, importId));
  } finally {
    await db.update(s.imports).set({ leaseUntil: null }).where(eq(s.imports.id, importId));
  }
  return getImport(db, importId);
}

async function getImport(db: Db, id: string): Promise<ImportRow> {
  const rows = await db.select().from(s.imports).where(eq(s.imports.id, id)).limit(1);
  if (!rows[0]) throw new Error("Importación no encontrada");
  return rows[0];
}

async function saveState(
  db: Db,
  row: ImportRow,
  patch: Partial<State>,
  extra: Partial<typeof s.imports.$inferInsert> = {},
  statsAdd: Record<string, number> = {},
) {
  const state = { ...(row.state as State), ...patch };
  const stats = { ...row.stats };
  for (const [k, v] of Object.entries(statsAdd)) stats[k] = (stats[k] ?? 0) + v;
  await db
    .update(s.imports)
    .set({ state: state as Record<string, unknown>, stats, updatedAt: new Date(), ...extra })
    .where(eq(s.imports.id, row.id));
  row.state = state as Record<string, unknown>;
  row.stats = stats;
}

const HANDLERS: Record<Exclude<ImportPhase, "done">, (row: ImportRow, deps: ImportDeps, deadline: number) => Promise<boolean>> = {
  index: phaseIndex,
  workouts: phaseWorkouts,
  samples: phaseSamples,
  series: phaseSeries,
  routes: phaseRoutes,
  finalize: phaseFinalize,
};

// ─── index ───────────────────────────────────────────────────────────────────

async function phaseIndex(row: ImportRow, deps: ImportDeps): Promise<boolean> {
  const entries = await readCentralDirectory(deps.source);
  // El nombre del XML puede ir traducido (export.xml, exportación.xml…): el .xml más grande que no sea CDA.
  const xml = entries
    .filter((e) => /\.xml$/i.test(e.name) && !/cda/i.test(basename(e.name)) && !e.name.includes("__MACOSX"))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];
  if (!xml) throw new Error("El zip no contiene el export de Apple Health (export.xml)");
  const gpx: Record<string, CompactEntry> = {};
  for (const e of entries) {
    if (/\.gpx$/i.test(e.name) && !e.name.includes("__MACOSX")) {
      gpx[basename(e.name)] = [e.localHeaderOffset, e.compressedSize, e.uncompressedSize, e.method];
    }
  }
  const dataStart = await entryDataStart(deps.source, xml);
  await saveState(
    deps.db,
    row,
    {
      xml: { name: xml.name, entry: [xml.localHeaderOffset, xml.compressedSize, xml.uncompressedSize, xml.method], dataStart },
      gpx,
      offset: 0,
      seq: 0,
    },
    { phase: "workouts", bytesTotal: xml.uncompressedSize, bytesProcessed: 0 },
    { gpxFiles: Object.keys(gpx).length },
  );
  return true;
}

// ─── pasadas por el XML ──────────────────────────────────────────────────────

/** Recorre export.xml desde `state.offset` hasta el final o hasta `deadline`. */
async function streamXml(
  row: ImportRow,
  deps: ImportDeps,
  deadline: number,
  targets: ScanTarget[],
  onMatch: (id: string, text: string) => void,
  checkpoint: (offset: number) => Promise<void>,
): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const state = row.state as State;
  if (!state.xml) throw new Error("Índice del zip ausente");
  const entry = toEntry(state.xml.name, state.xml.entry);
  const skip = state.offset ?? 0;
  const stream = await openEntryStream(deps.source, entry, state.xml.dataStart);
  const scanner = new XmlScanner(targets, skip);
  const emit = (m: { id: string; text: string }) => onMatch(m.id, m.text);
  let consumed = 0;
  let lastCheckpoint = now();
  let complete = true;

  try {
    for await (const raw of stream as AsyncIterable<Buffer>) {
      let chunk = raw;
      if (consumed + chunk.length <= skip) {
        consumed += chunk.length;
        continue;
      }
      if (consumed < skip) {
        chunk = chunk.subarray(skip - consumed);
        consumed = skip;
      }
      scanner.push(chunk, emit);
      consumed += chunk.length;
      const t = now();
      if (t >= deadline) {
        // Solo se corta si el punto de control avanza; si no, la siguiente
        // invocación repetiría exactamente lo mismo y no terminaría nunca.
        scanner.flush(emit);
        if (scanner.safeOffset > skip) {
          complete = false;
          break;
        }
      }
      if (t - lastCheckpoint >= CHECKPOINT_MS) {
        scanner.flush(emit);
        await checkpoint(scanner.safeOffset);
        lastCheckpoint = now();
      }
    }
  } finally {
    stream.destroy();
  }
  scanner.flush(emit);
  await checkpoint(complete ? entry.uncompressedSize : scanner.safeOffset);
  return complete;
}

async function phaseWorkouts(row: ImportRow, deps: ImportDeps, deadline: number): Promise<boolean> {
  const { db } = deps;
  let runs: ParsedRun[] = [];
  let vo2: { measuredAt: Date; value: number; sourceName: string }[] = [];
  let workouts = 0;
  let exportDate: Date | null = null;

  const targets: ScanTarget[] = [
    { id: "workout", start: "<Workout ", block: { close: "</Workout>" } },
    { id: "vo2", start: `<Record type="${Q}VO2Max"` },
    { id: "exportDate", start: "<ExportDate " },
  ];

  const onMatch = (id: string, text: string) => {
    if (id === "workout") {
      workouts++;
      if (workoutActivityType(text) !== RUNNING) return; // se descarta sin parsear
      const run = parseRunningWorkout(text);
      if (run) runs.push(run);
    } else if (id === "vo2") {
      const r = parseVo2Record(text);
      if (r) vo2.push(r);
    } else if (id === "exportDate") {
      exportDate = parseHealthDate(attr(text, "value"));
    }
  };

  const checkpoint = async (offset: number) => {
    const batchRuns = runs;
    const batchVo2 = vo2;
    const seen = workouts;
    runs = [];
    vo2 = [];
    workouts = 0;
    await db.transaction(async (tx) => {
      await upsertRuns(tx as unknown as Db, batchRuns, row.id);
      for (let i = 0; i < batchVo2.length; i += 500) {
        await tx
          .insert(s.vo2maxReadings)
          .values(batchVo2.slice(i, i + 500).map((v) => ({ ...v, importId: row.id })))
          .onConflictDoUpdate({
            target: [s.vo2maxReadings.measuredAt, s.vo2maxReadings.sourceName],
            set: { value: sql`excluded.value` },
          });
      }
      const extra: Partial<typeof s.imports.$inferInsert> = { bytesProcessed: offset };
      if (exportDate) extra.exportDate = exportDate;
      await saveState(tx as unknown as Db, row, { offset }, extra, {
        workoutsSeen: seen,
        runsFound: batchRuns.length,
        vo2Readings: batchVo2.length,
      });
    });
  };

  const complete = await streamXml(row, deps, deadline, targets, onMatch, checkpoint);
  if (complete) await saveState(db, row, { offset: 0 }, { phase: "samples", bytesProcessed: 0 });
  return complete;
}

async function upsertRuns(db: Db, runs: ParsedRun[], importId: string) {
  const metricCols = [
    "source",
    "sourceName",
    "sourceVersion",
    "device",
    "durationS",
    "distanceM",
    "avgPaceSPerKm",
    "avgHr",
    "maxHr",
    "avgPowerW",
    "avgSpeedMps",
    "avgStrideM",
    "avgVerticalOscCm",
    "avgGroundContactMs",
    "steps",
    "cadenceSpm",
    "elevationGainM",
    "temperatureC",
    "humidityPct",
    "isIndoor",
    "activeEnergyKcal",
    "routeFile",
    "raw",
  ] as const;
  const set: Record<string, unknown> = { importId, updatedAt: sql`now()` };
  for (const c of metricCols) set[c] = sql.raw(`excluded."${s.runs[c].name}"`);
  for (let i = 0; i < runs.length; i += 100) {
    await db
      .insert(s.runs)
      .values(runs.slice(i, i + 100).map((r) => ({ ...r, importId })))
      .onConflictDoUpdate({ target: s.runs.sourceKey, set });
  }
}

interface Window {
  id: string;
  start: number;
  end: number;
}

const SAMPLE_TYPES: Record<string, SeriesMetric> = {
  HeartRate: "hr",
  RunningPower: "power",
  RunningSpeed: "speed",
  DistanceWalkingRunning: "distance",
};

async function phaseSamples(row: ImportRow, deps: ImportDeps, deadline: number): Promise<boolean> {
  const { db } = deps;
  const runRows = await db
    .select({ id: s.runs.id, startAt: s.runs.startAt, endAt: s.runs.endAt, sourceName: s.runs.sourceName })
    .from(s.runs)
    .where(and(eq(s.runs.importId, row.id), isNotNull(s.runs.sourceName)));

  const bySource = new Map<string, Window[]>();
  for (const r of runRows) {
    const list = bySource.get(r.sourceName!) ?? [];
    list.push({ id: r.id, start: r.startAt.getTime(), end: r.endAt.getTime() });
    bySource.set(r.sourceName!, list);
  }
  for (const list of bySource.values()) list.sort((a, b) => a.start - b.start);

  const findRun = (sourceName: string, t: number): Window | null => {
    const list = bySource.get(sourceName);
    if (!list) return null;
    let lo = 0,
      hi = list.length - 1,
      ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans !== -1 && t <= list[ans].end ? list[ans] : null;
  };

  let buf = new Map<string, { runId: string; metric: SeriesMetric; t: number[]; v: number[] }>();
  let matched = 0;

  const targets: ScanTarget[] = Object.keys(SAMPLE_TYPES).map((k) => ({ id: k, start: `<Record type="${Q}${k}"` }));

  const onMatch = (id: string, tag: string) => {
    const sourceName = attr(tag, "sourceName");
    if (!sourceName || !bySource.has(sourceName)) return;
    const start = parseHealthDate(attr(tag, "startDate"));
    if (!start) return;
    const run = findRun(sourceName, start.getTime());
    if (!run) return;
    const metric = SAMPLE_TYPES[id];
    const unit = attr(tag, "unit");
    const rawValue = attr(tag, "value");
    let value: number | null;
    let at = start.getTime();
    if (metric === "distance") {
      value = toMeters(rawValue, unit);
      at = parseHealthDate(attr(tag, "endDate"))?.getTime() ?? at;
    } else if (metric === "speed") value = toMps(rawValue, unit);
    else value = toNumber(rawValue);
    if (value === null) return;
    const key = `${run.id}|${metric}`;
    let e = buf.get(key);
    if (!e) buf.set(key, (e = { runId: run.id, metric, t: [], v: [] }));
    e.t.push(Math.round((at - run.start) / 1000));
    e.v.push(value);
    matched++;
  };

  const checkpoint = async (offset: number) => {
    const batch = [...buf.values()];
    const n = matched;
    buf = new Map();
    matched = 0;
    await db.transaction(async (tx) => {
      const seq = ((row.state as State).seq ?? 0) + 1;
      for (let i = 0; i < batch.length; i += 50) {
        await tx.insert(s.importSamples).values(
          batch.slice(i, i + 50).map((b) => ({ importId: row.id, runId: b.runId, metric: b.metric, seq, t: b.t, v: b.v })),
        );
      }
      await saveState(tx as unknown as Db, row, { offset, seq }, { bytesProcessed: offset }, { samples: n });
    });
  };

  const complete = await streamXml(row, deps, deadline, targets, onMatch, checkpoint);
  if (complete) await saveState(db, row, { offset: 0 }, { phase: "series" });
  return complete;
}

// ─── series ──────────────────────────────────────────────────────────────────

async function phaseSeries(row: ImportRow, deps: ImportDeps, deadline: number): Promise<boolean> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  for (let batches = 0; ; batches++) {
    // Al menos un lote por invocación: si no, nunca avanzaría.
    if (batches > 0 && now() >= deadline) return false;
    const pending = await db
      .selectDistinct({ runId: s.importSamples.runId })
      .from(s.importSamples)
      .where(eq(s.importSamples.importId, row.id))
      .limit(20);
    if (pending.length === 0) break;
    const ids = pending.map((p) => p.runId);
    const rows = await db
      .select()
      .from(s.importSamples)
      .where(and(eq(s.importSamples.importId, row.id), inArray(s.importSamples.runId, ids)));
    const merged = new Map<string, { runId: string; metric: SeriesMetric; pairs: [number, number][] }>();
    for (const r of rows) {
      const key = `${r.runId}|${r.metric}`;
      let m = merged.get(key);
      if (!m) merged.set(key, (m = { runId: r.runId, metric: r.metric, pairs: [] }));
      for (let i = 0; i < r.t.length; i++) m.pairs.push([r.t[i], r.v[i]]);
    }
    await db.transaction(async (tx) => {
      for (const m of merged.values()) {
        m.pairs.sort((a, b) => a[0] - b[0]);
        const t = m.pairs.map((p) => p[0]);
        const v = m.pairs.map((p) => p[1]);
        await tx
          .insert(s.runSeries)
          .values({ runId: m.runId, metric: m.metric, t, v })
          .onConflictDoUpdate({ target: [s.runSeries.runId, s.runSeries.metric], set: { t, v } });
      }
      await tx
        .delete(s.importSamples)
        .where(and(eq(s.importSamples.importId, row.id), inArray(s.importSamples.runId, ids)));
      // Latido de progreso para la pantalla.
      await saveState(tx as unknown as Db, row, {}, {}, { seriesRuns: ids.length });
    });
  }
  await saveState(db, row, { unrefIdx: 0 }, { phase: "routes" });
  return true;
}

// ─── rutas y parciales ───────────────────────────────────────────────────────

async function loadSeries(db: Db, runId: string): Promise<Partial<Record<SeriesMetric, Series>>> {
  const rows = await db.select().from(s.runSeries).where(eq(s.runSeries.runId, runId));
  return Object.fromEntries(rows.map((r) => [r.metric, { t: r.t, v: r.v }]));
}

async function writeSplits(db: Db, run: { id: string; startAt: Date }, gpx: GpxPoint[] | null): Promise<number> {
  const series = await loadSeries(db, run.id);
  const start = run.startAt.getTime();
  let dist: Series | null = null;
  let basis: "samples" | "gpx" = "samples";
  if (series.distance && series.distance.t.length > 1) {
    dist = cumulativeFromIntervals(series.distance);
  } else if (gpx && gpx.length > 1 && gpx.every((p) => p.time !== null)) {
    const cum = cumulativeDistance(gpx);
    dist = { t: gpx.map((p) => (p.time! - start) / 1000), v: cum };
    basis = "gpx";
  }
  if (!dist) return 0;
  let elevation: Series | undefined;
  if (gpx) {
    const withEle = gpx.filter((p) => p.time !== null && p.ele !== null);
    if (withEle.length > 1) elevation = { t: withEle.map((p) => (p.time! - start) / 1000), v: withEle.map((p) => p.ele!) };
  }
  const splits = computeSplits(dist, { hr: series.hr, power: series.power, elevation });
  await db.transaction(async (tx) => {
    await tx.delete(s.runSplits).where(eq(s.runSplits.runId, run.id));
    if (splits.length) await tx.insert(s.runSplits).values(splits.map((sp) => ({ ...sp, runId: run.id, basis })));
  });
  return splits.length;
}

async function storeRoute(
  deps: ImportDeps,
  run: { id: string; startAt: Date },
  fileName: string,
  body: Buffer,
): Promise<boolean> {
  const pts = parseGpx(body.toString("utf8"));
  if (pts.length < 2) return false;
  const url = await deps.putRoute(`routes/${run.id}.gpx`, body);
  const simple = simplify(pts, 4);
  const box = bbox(pts);
  const cum = cumulativeDistance(pts);
  const { gain } = elevationGainLoss(pts.map((p) => p.ele));
  const values = {
    runId: run.id,
    blobUrl: url,
    fileName,
    pointCount: pts.length,
    polyline: encodePolyline(simple),
    ...box,
    gpxDistanceM: cum[cum.length - 1],
    gpxElevationGainM: pts.some((p) => p.ele !== null) ? gain : null,
  };
  await deps.db
    .insert(s.runRoutes)
    .values(values)
    .onConflictDoUpdate({ target: s.runRoutes.runId, set: { ...values, createdAt: undefined } });
  await writeSplits(deps.db, run, pts);
  return true;
}

async function phaseRoutes(row: ImportRow, deps: ImportDeps, deadline: number): Promise<boolean> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const state = row.state as State;
  const gpx = state.gpx ?? {};
  const skipped = new Set(state.routeSkipped ?? []);

  // 1) Carreras con <FileReference> a su GPX.
  const referenced = await db
    .select({ id: s.runs.id, startAt: s.runs.startAt, routeFile: s.runs.routeFile })
    .from(s.runs)
    .leftJoin(s.runRoutes, eq(s.runRoutes.runId, s.runs.id))
    .where(and(eq(s.runs.importId, row.id), isNotNull(s.runs.routeFile), isNull(s.runRoutes.runId)));

  let linked = 0;
  let missing = 0;
  let processed = 0;
  for (const r of referenced) {
    if (skipped.has(r.id)) continue;
    if (processed > 0 && now() >= deadline) {
      await saveState(db, row, { routeSkipped: [...skipped] }, {}, { routesLinked: linked, routesMissing: missing });
      return false;
    }
    const name = basename(r.routeFile!);
    const c = gpx[name];
    const ok = c ? await storeRoute(deps, r, name, await readSmallEntry(deps.source, toEntry(name, c))) : false;
    if (ok) linked++;
    else {
      missing++;
      skipped.add(r.id);
    }
    processed++;
    if (processed % 5 === 0) {
      await saveState(db, row, { routeSkipped: [...skipped] }, {}, { routesLinked: linked, routesMissing: missing });
      linked = 0;
      missing = 0;
    }
  }
  await saveState(db, row, { routeSkipped: [...skipped] }, {}, { routesLinked: linked, routesMissing: missing });

  // 2) GPX sin referencia: se enlazan por hora de inicio/fin con carreras sin ruta.
  const refNames = new Set(
    (await db.select({ f: s.runs.routeFile }).from(s.runs).where(isNotNull(s.runs.routeFile))).map((x) => basename(x.f!)),
  );
  const unref = Object.keys(gpx)
    .filter((n) => !refNames.has(n))
    .sort();
  let idx = state.unrefIdx ?? 0;
  let timeLinked = 0;
  const firstIdx = idx;
  const workedBefore = processed > 0;
  while (idx < unref.length) {
    if ((workedBefore || idx > firstIdx) && now() >= deadline) {
      await saveState(db, row, { unrefIdx: idx }, {}, { routesTimeLinked: timeLinked });
      return false;
    }
    const name = unref[idx++];
    const body = await readSmallEntry(deps.source, toEntry(name, gpx[name]));
    const pts = parseGpx(body.toString("utf8"));
    const times = pts.map((p) => p.time).filter((t): t is number => t !== null);
    if (times.length < 2) continue;
    const t0 = new Date(Math.min(...times));
    const t1 = new Date(Math.max(...times));
    const candidates = await db
      .select({ id: s.runs.id, startAt: s.runs.startAt, endAt: s.runs.endAt, source: s.runs.source })
      .from(s.runs)
      .leftJoin(s.runRoutes, eq(s.runRoutes.runId, s.runs.id))
      .where(
        and(
          isNull(s.runRoutes.runId),
          isNull(s.runs.routeFile),
          sql`${s.runs.startAt} <= ${t1} AND ${s.runs.endAt} >= ${t0}`,
          sql`coalesce(${s.runs.isIndoor}, false) = false`,
        ),
      );
    const overlap = (c: { startAt: Date; endAt: Date }) =>
      Math.min(c.endAt.getTime(), t1.getTime()) - Math.max(c.startAt.getTime(), t0.getTime());
    const best = candidates.sort(
      (a, b) => Number(b.source === "apple_watch") - Number(a.source === "apple_watch") || overlap(b) - overlap(a),
    )[0];
    if (best && (await storeRoute(deps, best, name, body))) {
      await db.update(s.runs).set({ routeFile: name }).where(eq(s.runs.id, best.id));
      timeLinked++;
    }
  }
  await saveState(db, row, { unrefIdx: idx, splitsTried: [] }, { phase: "finalize" }, { routesTimeLinked: timeLinked });
  return true;
}

// ─── finalize ────────────────────────────────────────────────────────────────

async function phaseFinalize(row: ImportRow, deps: ImportDeps, deadline: number): Promise<boolean> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const tried = new Set((row.state as State).splitsTried ?? []);

  // Parciales de las carreras sin GPX (cinta) a partir de la distancia del reloj.
  const noSplits = await db
    .select({ id: s.runs.id, startAt: s.runs.startAt })
    .from(s.runs)
    .leftJoin(s.runSplits, and(eq(s.runSplits.runId, s.runs.id), eq(s.runSplits.idx, 1)))
    .where(
      and(
        eq(s.runs.importId, row.id),
        isNull(s.runSplits.runId),
        tried.size ? notInArray(s.runs.id, [...tried]) : sql`true`,
      ),
    );
  let done = 0;
  for (const r of noSplits) {
    if (done > 0 && now() >= deadline) {
      await saveState(db, row, { splitsTried: [...tried] });
      return false;
    }
    await writeSplits(db, r, null);
    tried.add(r.id);
    done++;
  }

  // Deduplicado y clasificación sobre todas las carreras (no solo las de este zip).
  const all = await db
    .select({
      id: s.runs.id,
      source: s.runs.source,
      startAt: s.runs.startAt,
      distanceM: s.runs.distanceM,
      avgPaceSPerKm: s.runs.avgPaceSPerKm,
    })
    .from(s.runs);
  const result = classifyRuns(all);
  const ids = [...result.keys()];
  const vals = ids.map((id) => result.get(id)!);
  if (ids.length) {
    await db.execute(sql`
      UPDATE runs SET
        status = x.status,
        invalid_reason = x.reason,
        duplicate_of = x.dup,
        is_special = x.special,
        updated_at = now()
      FROM (
        SELECT * FROM unnest(
          ${sql.param(ids)}::uuid[],
          ${sql.param(vals.map((v) => v.status))}::text[],
          ${sql.param(vals.map((v) => v.invalidReason))}::text[],
          ${sql.param(vals.map((v) => v.duplicateOf))}::uuid[],
          ${sql.param(vals.map((v) => v.isSpecial))}::boolean[]
        ) AS t(id, status, reason, dup, special)
      ) x
      WHERE runs.id = x.id`);
  }

  const count = (pred: (c: (typeof vals)[number]) => boolean) => vals.filter(pred).length;
  const stats = {
    ...row.stats,
    runsTotal: vals.length,
    runsValid: count((c) => c.status === "valid"),
    runsInvalid: count((c) => c.status === "invalid"),
    runsDuplicate: count((c) => c.status === "duplicate"),
    runsSpecial: count((c) => c.status === "valid" && c.isSpecial),
  };
  // Tipos de sesión automáticos (el tipo manual no se toca).
  await reclassifyAll(db);
  await db
    .update(s.imports)
    .set({ phase: "done", status: "done", stats, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(s.imports.id, row.id));
  return true;
}
