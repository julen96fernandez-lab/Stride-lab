// Aplica las migraciones SQL de ./drizzle que falten. Se ejecuta antes de `next build`
// en Vercel. Registra cada migración aplicada en la tabla _migrations.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool as NeonPool } from "@neondatabase/serverless";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] Sin DATABASE_URL: se omiten las migraciones.");
  process.exit(0);
}

const host = new URL(url).hostname;
const local = host === "localhost" || host === "127.0.0.1";
const pool = local ? new pg.Pool({ connectionString: url }) : new NeonPool({ connectionString: url });
const client = await pool.connect();

try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name));
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const statements = readFileSync(join(dir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await client.query("BEGIN");
    try {
      for (const s of statements) await client.query(s);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    console.log(`[migrate] aplicada ${file} (${statements.length} sentencias)`);
  }
  console.log("[migrate] al día.");
} finally {
  client.release();
  await pool.end();
}
