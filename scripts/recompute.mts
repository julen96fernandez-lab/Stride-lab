// Tras migrar y antes de `next build`: si las reglas cambiaron (versión del clasificador),
// recalcula tipos, carga, lesiones y mejores esfuerzos con los datos ya guardados.
// Nunca rompe el despliegue: si falla, la app lo reintenta al abrirse.
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/lib/db/schema";
import { ensureClassified } from "../src/lib/analysis/session-type-db";

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
} finally {
  await pool.end().catch(() => {});
}
process.exit(0);
