/**
 * Ejecuta «Revisar datos de salud» por tramos (como el importador: reanudable y con reserva).
 * Solo lee: carreras (para saber qué pasos caen dentro de cada una) y el zip. Lo único que
 * escribe es su propia fila de `health_scans` (progreso y recuentos).
 */
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { locateXml, streamXmlEntry, type XmlRef } from "@/lib/import/pipeline";
import type { ScanTarget } from "@/lib/import/scanner";
import { attr, parseHealthDate } from "@/lib/import/xml";
import type { RangeSource } from "@/lib/import/zip";
import { HEALTH_TARGETS, STEP_TARGET, addReading, addStep, madridDay, newCensus, sourceKind, summarizeCensus, type Census, type CensusSummary } from "./census";

type ScanRow = typeof s.healthScans.$inferSelect;
interface ScanState {
  xml?: XmlRef;
  offset?: number;
}


/** Crea la revisión del último zip importado (o devuelve la que esté a medias). */
export async function startHealthScan(db: Db): Promise<ScanRow | null> {
  const open = await db.select().from(s.healthScans).where(ne(s.healthScans.status, "done")).orderBy(desc(s.healthScans.createdAt)).limit(1);
  if (open[0] && open[0].status !== "failed") return open[0];
  const imp = (
    await db
      .select({ id: s.imports.id, blobUrl: s.imports.blobUrl, blobPathname: s.imports.blobPathname, exportDate: s.imports.exportDate })
      .from(s.imports)
      .where(eq(s.imports.status, "done"))
      .orderBy(desc(s.imports.createdAt))
      .limit(1)
  )[0];
  if (!imp) return null;
  const [row] = await db
    .insert(s.healthScans)
    .values({ importId: imp.id, blobUrl: imp.blobUrl, blobPathname: imp.blobPathname, exportDate: imp.exportDate })
    .returning();
  return row;
}

export async function latestHealthScan(db: Db): Promise<ScanRow | null> {
  return (await db.select().from(s.healthScans).orderBy(desc(s.healthScans.createdAt)).limit(1))[0] ?? null;
}

export async function getHealthScan(db: Db, id: string): Promise<ScanRow | null> {
  return (await db.select().from(s.healthScans).where(eq(s.healthScans.id, id)).limit(1))[0] ?? null;
}

interface Window {
  id: string;
  start: number;
  end: number;
}

/** Avanza la revisión hasta `deadline`. */
export async function runHealthScanStep(id: string, deps: { db: Db; source: RangeSource; now?: () => number }, deadline: number): Promise<ScanRow> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  let row = (await getHealthScan(db, id))!;
  if (!row || row.status === "done") return row;
  const claimed = await db
    .update(s.healthScans)
    .set({ status: "processing", error: null, leaseUntil: sql`now() + interval '330 seconds'`, updatedAt: new Date() })
    .where(and(eq(s.healthScans.id, id), sql`(${s.healthScans.leaseUntil} IS NULL OR ${s.healthScans.leaseUntil} < now())`))
    .returning({ id: s.healthScans.id });
  if (!claimed.length) return row;

  try {
    let state = row.state as ScanState;
    if (!state.xml) {
      const { xml } = await locateXml(deps.source);
      state = { xml, offset: 0 };
      await db.update(s.healthScans).set({ state: state as Record<string, unknown>, bytesTotal: xml.entry[2], updatedAt: new Date() }).where(eq(s.healthScans.id, id));
    }
    const census: Census = (row.census as unknown as Census | null) ?? newCensus();

    // Ventanas de las carreras válidas por fuente (los pasos deben ser de la misma fuente).
    const runs = await db
      .select({ id: s.runs.id, startAt: s.runs.startAt, endAt: s.runs.endAt, sourceName: s.runs.sourceName })
      .from(s.runs)
      .where(and(eq(s.runs.status, "valid"), isNotNull(s.runs.sourceName)));
    const bySource = new Map<string, Window[]>();
    for (const r of runs) {
      if (sourceKind(r.sourceName) !== "watch") continue;
      const list = bySource.get(r.sourceName!) ?? [];
      list.push({ id: r.id, start: r.startAt.getTime(), end: r.endAt.getTime() });
      bySource.set(r.sourceName!, list);
    }
    for (const list of bySource.values()) list.sort((a, b) => a.start - b.start);
    const findRun = (src: string, t: number): Window | null => {
      const list = bySource.get(src);
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

    const targets: ScanTarget[] = [...HEALTH_TARGETS.map((t) => ({ id: t.kind, start: t.start })), { id: "steps", start: STEP_TARGET }];
    const onMatch = (kind: string, tag: string) => {
      const sourceName = attr(tag, "sourceName") ?? null;
      const start = parseHealthDate(attr(tag, "startDate"));
      if (!start) return;
      if (kind === "steps") {
        if (!sourceName || !bySource.has(sourceName)) return;
        const run = findRun(sourceName, start.getTime());
        if (run) addStep(census, run.id, Math.round((start.getTime() - run.start) / 1000));
        return;
      }
      addReading(census, kind as (typeof HEALTH_TARGETS)[number]["kind"], {
        sourceName,
        start,
        end: parseHealthDate(attr(tag, "endDate")),
        value: attr(tag, "value") ?? null,
      });
    };
    const checkpoint = async (offset: number) => {
      state = { ...state, offset };
      await db
        .update(s.healthScans)
        .set({ state: state as Record<string, unknown>, census: census as unknown as Record<string, unknown>, bytesProcessed: offset, updatedAt: new Date() })
        .where(eq(s.healthScans.id, id));
    };
    const complete = await streamXmlEntry({ source: deps.source, xml: state.xml!, offset: state.offset ?? 0, now, deadline, targets, onMatch, checkpoint });
    if (complete) await db.update(s.healthScans).set({ status: "done", finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.healthScans.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(s.healthScans).set({ status: "failed", error: message.slice(0, 2000), updatedAt: new Date() }).where(eq(s.healthScans.id, id));
  } finally {
    await db.update(s.healthScans).set({ leaseUntil: null }).where(eq(s.healthScans.id, id));
  }
  row = (await getHealthScan(db, id))!;
  return row;
}

export interface HealthScanView {
  id: string;
  status: ScanRow["status"];
  pct: number;
  error: string | null;
  exportDay: string | null;
  createdAt: string;
  finishedAt: string | null;
  summary: CensusSummary | null;
}

/** Vista para la pantalla (el resumen solo al terminar). */
export async function toHealthScanView(db: Db, row: ScanRow): Promise<HealthScanView> {
  const exportDay = row.exportDate ? madridDay(row.exportDate) : null;
  let summary: CensusSummary | null = null;
  if (row.status === "done" && row.census) {
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM runs WHERE status = 'valid' AND source = 'apple_watch'`)).rows as { n: number }[];
    summary = summarizeCensus(row.census as unknown as Census, exportDay ?? madridDay(row.finishedAt ?? new Date()), n);
  }
  return {
    id: row.id,
    status: row.status,
    pct: row.bytesTotal ? Math.min(1, row.bytesProcessed / row.bytesTotal) : 0,
    error: row.error,
    exportDay,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    summary,
  };
}
