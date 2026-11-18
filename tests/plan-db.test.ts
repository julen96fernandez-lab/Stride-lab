/** Plan editable con base de datos: mis sesiones y quitar/recuperar la sugerencia (TEST_DATABASE_URL). */
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { deleteMine, dismissWeek, freezeWeek, getMine, getStoredWeeks, listMine, restoreWeek, saveMine } from "@/lib/plan/plan-db";
import type { WeekSession } from "@/lib/plan/weekly";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("plan editable (base de datos)", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  beforeEach(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    await db.execute(sql`TRUNCATE planned_sessions, plan_weeks`);
  });
  afterAll(() => pool.end());

  const mine = { date: "2026-11-21", kind: "tirada_larga" as const, distanceM: 16000, durationS: null, note: "con Ane", replacesWeek: "2026-11-16" };
  const week = (start: string): WeekSession => ({
    start, end: start, kind: "libre", pos: 2, session: "calidad", label: "Calidad", day: start, dayLabel: "", when: null, reason: "r", downgraded: false,
  });

  it("crear, listar por fechas, editar (conserva la semana que sustituye) y borrar", async () => {
    const id = await saveMine(db, mine);
    await saveMine(db, { ...mine, date: "2026-12-01", replacesWeek: null });
    expect((await listMine(db, "2026-11-16", "2026-11-22")).map((m) => m.date)).toEqual(["2026-11-21"]);
    await saveMine(db, { ...mine, date: "2026-11-22", kind: "suave", replacesWeek: null }, id);
    const m = (await getMine(db, id))!;
    expect(m).toMatchObject({ date: "2026-11-22", kind: "suave", replacesWeek: "2026-11-16", note: "con Ane" });
    await deleteMine(db, id);
    expect(await getMine(db, id)).toBeNull();
    expect(await listMine(db, "2026-01-01", "2027-01-01")).toHaveLength(1);
  });

  it("quitar la sugerencia: congela la semana marcada; recuperar la futura la libera, la actual la desmarca", async () => {
    await dismissWeek(db, week("2026-11-30"));
    await freezeWeek(db, week("2026-11-16"));
    await dismissWeek(db, week("2026-11-16"));
    let rows = await getStoredWeeks(db, "2026-11-01", "2026-12-31");
    expect(rows.map((r) => [r.weekStart, r.dismissed]).sort()).toEqual([["2026-11-16", true], ["2026-11-30", true]]);
    await restoreWeek(db, "2026-11-30", "2026-11-16");
    await restoreWeek(db, "2026-11-16", "2026-11-16");
    rows = await getStoredWeeks(db, "2026-11-01", "2026-12-31");
    expect(rows.map((r) => [r.weekStart, r.dismissed])).toEqual([["2026-11-16", false]]);
  });
});
