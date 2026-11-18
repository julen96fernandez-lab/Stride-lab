import "server-only";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";
import { AsyncLocalStorage } from "node:async_hooks";
import type { QuerySpan } from "@/lib/perf/trace";

/** Diagnóstico: dentro de `queryTrace.run(spans, fn)` cada consulta deja su inicio y fin. */
export const queryTrace = new AsyncLocalStorage<QuerySpan[]>();

function traced<P extends { query: (...a: never[]) => unknown }>(pool: P): P {
  const orig = pool.query.bind(pool) as (...a: unknown[]) => unknown;
  (pool as { query: unknown }).query = (...a: unknown[]) => {
    const spans = queryTrace.getStore();
    const r = orig(...a);
    if (!spans || !r || typeof (r as Promise<unknown>).then !== "function") return r;
    const span = { start: performance.now(), end: -1 };
    spans.push(span);
    return (r as Promise<unknown>).then(
      (v) => ((span.end = performance.now()), v),
      (e) => {
        span.end = performance.now();
        throw e;
      },
    );
  };
  return pool;
}

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
  if (isLocal(url)) return drizzlePg(traced(new PgPool({ connectionString: url, max: 4 })), { schema });
  return drizzleNeon(traced(new NeonPool({ connectionString: url, max: 4 })), { schema }) as unknown as ReturnType<
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
