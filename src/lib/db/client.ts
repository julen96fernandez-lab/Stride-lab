import "server-only";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

function databaseUrl(): string {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL no está configurada");
  return u;
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function makeDb() {
  const url = databaseUrl();
  // En local (pruebas) Postgres normal; en Vercel, Neon por WebSocket (admite transacciones).
  if (isLocal(url)) return drizzlePg(new PgPool({ connectionString: url, max: 4 }), { schema });
  return drizzleNeon(new NeonPool({ connectionString: url, max: 4 }), { schema }) as unknown as ReturnType<
    typeof drizzlePg<typeof schema>
  >;
}

export type Db = ReturnType<typeof makeDb>;

let _db: Db | undefined;

/** Cliente Drizzle compartido por la instancia de la función. */
export function db(): Db {
  return (_db ??= makeDb());
}

export { schema };
