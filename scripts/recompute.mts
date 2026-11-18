// Tras migrar y antes de `next build`: si las reglas cambiaron (versión del clasificador),
// recalcula tipos, carga, lesiones y mejores esfuerzos con los datos ya guardados.
// Nunca rompe el despliegue: si falla, la app lo reintenta al abrirse.
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/lib/db/schema";
import { ensureClassified } from "../src/lib/analysis/session-type-db";
import { ensureTrack } from "../src/lib/analysis/track-db";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[recompute] Sin DATABASE_URL: se omite.");
  process.exit(0);
}
const host = new URL(url).hostname;
const local = host === "localhost" || host === "127.0.0.1";
const pool = local ? new pg.Pool({ connectionString: url, max: 2 }) : new NeonPool({ connectionString: url, max: 2 });
const db = (local ? drizzlePg(pool as pg.Pool, { schema }) : drizzleNeon(pool as NeonPool, { schema })) as unknown as Parameters<
  typeof ensureClassified
>[0];

const t0 = Date.now();
try {
  await ensureClassified(db);
  console.log(`[recompute] al día (${Date.now() - t0} ms).`);
} catch (err) {
  console.log("[recompute] no se pudo recalcular; se hará al abrir la app:", err instanceof Error ? err.message : err);
}

// Pistas con tiempo (mapa sincronizado): se rellenan las que falten leyendo el GPX de Blob.
try {
  const t1 = Date.now();
  const res = await (db as unknown as { execute: (q: unknown) => Promise<{ rows: { id: string; start_at: string; blob_url: string }[] }> }).execute(sql`
    SELECT r.id, r.start_at, rr.blob_url FROM runs r JOIN run_routes rr ON rr.run_id = r.id
    LEFT JOIN run_tracks t ON t.run_id = r.id WHERE t.run_id IS NULL`);
  const todo = res.rows;
  let ok = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const got = await Promise.all(
      todo.slice(i, i + 4).map((r) => ensureTrack(db as never, { id: r.id, startAt: new Date(r.start_at) }, r.blob_url).catch(() => null)),
    );
    ok += got.filter(Boolean).length;
    if (Date.now() - t1 > 240_000) break; // no alargar el build: el resto, al abrir cada carrera
  }
  console.log(`[recompute] pistas: ${ok} nuevas de ${todo.length} pendientes (${Date.now() - t1} ms).`);
} catch (err) {
  console.log("[recompute] pistas: no se pudieron preparar; se harán al abrir cada carrera:", err instanceof Error ? err.message : err);
} finally {
  await pool.end().catch(() => {});
}
process.exit(0);
