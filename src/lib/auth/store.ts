import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

const PASSWORD_KEY = "password_hash";

export async function getPasswordHash(): Promise<string | null> {
  const rows = await db()
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, PASSWORD_KEY))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function isPasswordSet(): Promise<boolean> {
  return (await getPasswordHash()) !== null;
}

/**
 * Guarda la contraseña solo si todavía no existe ninguna (primer acceso).
 * Devuelve false si ya estaba configurada: /setup no puede sobrescribirla.
 */
export async function setInitialPasswordHash(hash: string): Promise<boolean> {
  const rows = await db()
    .insert(schema.appSettings)
    .values({ key: PASSWORD_KEY, value: hash })
    .onConflictDoNothing()
    .returning({ key: schema.appSettings.key });
  return rows.length === 1;
}

export async function updatePasswordHash(hash: string): Promise<void> {
  await db()
    .update(schema.appSettings)
    .set({ value: hash, updatedAt: sql`now()` })
    .where(eq(schema.appSettings.key, PASSWORD_KEY));
}
