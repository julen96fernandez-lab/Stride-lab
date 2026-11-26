import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { isMonday, isShiftKind, type ShiftKind } from "./shifts";

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

// ─── Cambios de turno de un día ─────────────────────────────────────────────

export async function listShiftOverrides(db: Db, from: string, to: string): Promise<Record<string, ShiftKind>> {
  const rows = await db.select().from(s.shiftOverrides).where(and(gte(s.shiftOverrides.date, from), lte(s.shiftOverrides.date, to)));
  return Object.fromEntries(rows.filter((r) => isShiftKind(r.kind)).map((r) => [r.date, r.kind as ShiftKind]));
}

/** Cambia el turno de un día (null quita el cambio y vuelve al del ciclo). */
export async function setShiftOverride(db: Db, date: string, kind: ShiftKind | null): Promise<void> {
  if (kind === null) {
    await db.delete(s.shiftOverrides).where(eq(s.shiftOverrides.date, date));
    return;
  }
  await db
    .insert(s.shiftOverrides)
    .values({ date, kind })
    .onConflictDoUpdate({ target: s.shiftOverrides.date, set: { kind, updatedAt: sql`now()` } });
}
