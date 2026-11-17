import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/lib/db/client";

export type ImportView = {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  status: string;
  phase: string;
  bytesProcessed: number;
  bytesTotal: number | null;
  stats: Record<string, number>;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  exportDate: string | null;
};

export type CheckRun = {
  id: string;
  startAt: string;
  distanceM: number | null;
  durationS: number;
  avgPaceSPerKm: number | null;
  avgHr: number | null;
  avgPowerW: number | null;
};

type Row = typeof s.imports.$inferSelect;

export function toView(r: Row): ImportView {
  return {
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    status: r.status,
    phase: r.phase,
    bytesProcessed: r.bytesProcessed,
    bytesTotal: r.bytesTotal,
    stats: r.stats,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    exportDate: r.exportDate?.toISOString() ?? null,
  };
}

export async function getImportView(id: string): Promise<ImportView | null> {
  const rows = await db().select().from(s.imports).where(eq(s.imports.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function latestImport(): Promise<ImportView | null> {
  const rows = await db().select().from(s.imports).orderBy(desc(s.imports.createdAt)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** Carrera de comprobación: la más larga del 17‑oct‑2026 (hora de Madrid). */
export async function checkRun(): Promise<CheckRun | null> {
  const rows = await db()
    .select()
    .from(s.runs)
    .where(sql`(${s.runs.startAt} AT TIME ZONE 'Europe/Madrid')::date = '2026-10-17' AND ${s.runs.status} = 'valid'`)
    .orderBy(desc(s.runs.distanceM))
    .limit(1);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        startAt: r.startAt.toISOString(),
        distanceM: r.distanceM,
        durationS: r.durationS,
        avgPaceSPerKm: r.avgPaceSPerKm,
        avgHr: r.avgHr,
        avgPowerW: r.avgPowerW,
      }
    : null;
}
