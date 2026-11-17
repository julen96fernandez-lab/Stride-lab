import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMPTY_GOALS, type Goals } from "./periods";

const KEY = "km_goals";

export async function getGoals(db: Db): Promise<Goals> {
  const rows = await db.select().from(s.appSettings).where(eq(s.appSettings.key, KEY)).limit(1);
  if (!rows[0]) return EMPTY_GOALS;
  try {
    const v = JSON.parse(rows[0].value) as Partial<Goals>;
    return { week: { ...EMPTY_GOALS.week, ...v.week }, month: { ...EMPTY_GOALS.month, ...v.month }, year: { ...EMPTY_GOALS.year, ...v.year } };
  } catch {
    return EMPTY_GOALS;
  }
}

export async function saveGoals(db: Db, g: Goals): Promise<void> {
  const value = JSON.stringify(g);
  await db
    .insert(s.appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: s.appSettings.key, set: { value, updatedAt: sql`now()` } });
}
