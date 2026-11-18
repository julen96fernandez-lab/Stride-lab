import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { isMonday } from "./shifts";

const KEY = "shift_anchor";

/** Lunes de inicio de un bloque de tardes (AAAA-MM-DD) o null si no está configurado. */
export async function getShiftAnchor(db: Db): Promise<string | null> {
  const rows = await db.select().from(s.appSettings).where(eq(s.appSettings.key, KEY)).limit(1);
  const v = rows[0]?.value ?? null;
  return v && isMonday(v) ? v : null;
}

export async function saveShiftAnchor(db: Db, ymd: string): Promise<void> {
  if (!isMonday(ymd)) throw new Error("El inicio del bloque debe ser un lunes");
  await db
    .insert(s.appSettings)
    .values({ key: KEY, value: ymd })
    .onConflictDoUpdate({ target: s.appSettings.key, set: { value: ymd, updatedAt: sql`now()` } });
}
