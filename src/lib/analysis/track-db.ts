import "server-only";
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { parseGpx } from "@/lib/import/gpx";
import { reduceTrack, type Track } from "./run-stream";

/**
 * Pista con tiempo de una carrera. La primera vez se lee el GPX completo de Blob y se guarda
 * reducida (≤ 1 punto cada 2 s). Si el GPX no trae horas se guarda vacía para no volver a
 * leerlo. Si Blob falla, devuelve null sin guardar nada (se reintenta la próxima vez).
 */
export async function ensureTrack(db: Db, run: { id: string; startAt: Date }, blobUrl: string | null): Promise<Track | null> {
  const rows = await db.select().from(s.runTracks).where(eq(s.runTracks.runId, run.id)).limit(1);
  const row = rows[0];
  if (row) return row.t.length > 1 ? { t: row.t, lat: row.lat, lon: row.lon, ele: row.ele ?? row.t.map(() => null) } : null;
  if (!blobUrl) return null;

  let xml: string;
  try {
    const res = await get(blobUrl, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    xml = await new Response(res.stream).text();
  } catch {
    return null;
  }
  const track = reduceTrack(parseGpx(xml), run.startAt.getTime(), 2);
  await db
    .insert(s.runTracks)
    .values({
      runId: run.id,
      t: track?.t ?? [],
      lat: track?.lat ?? [],
      lon: track?.lon ?? [],
      ele: track && track.ele.some((e) => e !== null) ? (track.ele as number[]) : null,
    })
    .onConflictDoNothing();
  return track;
}
