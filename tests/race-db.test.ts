/** Carreras objetivo con base de datos: guardar, vincular, desvincular y borrar (TEST_DATABASE_URL). */
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { deleteRace, getRace, linkRun, listRaces, saveRace, unlinkRun } from "@/lib/race/race-db";
import { saveManualRun } from "@/lib/manual/manual-db";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("carreras objetivo (base de datos)", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  const putRoute = async (p: string) => `memory://${p}`;
  beforeEach(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    await db.execute(sql`TRUNCATE race_goals, imports, runs, app_settings CASCADE`);
  });
  afterAll(() => pool.end());

  const race = { name: "Media", date: "2026-12-20", distanceKey: "half" as const, distanceM: 21097.5, startTime: "09:30", targetS: 6300 };
  const run = () =>
    saveManualRun({ db, putRoute }, {
      startAt: new Date("2026-12-20T08:31:00Z"), distanceM: 21150, durationS: 6250, avgHr: null, maxHr: null, elevationGainM: null,
      cadenceSpm: null, avgPowerW: null, temperatureC: null, sessionType: null, isIndoor: false,
    });

  it("guardar, editar y listar varias (por fecha)", async () => {
    const a = await saveRace(db, race);
    await saveRace(db, { ...race, name: "10K", date: "2026-12-06", distanceKey: "10k", distanceM: 10000, targetS: 2700 });
    expect((await listRaces(db)).map((r) => r.name)).toEqual(["10K", "Media"]);
    await saveRace(db, { ...race, targetS: 6200 }, { id: a });
    expect((await getRace(db, a))!.targetS).toBe(6200);
  });
  it("vincular marca la carrera como Competición; desvincular no toca el tipo", async () => {
    const id = await saveRace(db, race);
    const runId = await run();
    await linkRun(db, id, runId, true);
    expect((await getRace(db, id))!.runId).toBe(runId);
    const r = (await db.select().from(s.runs).where(eq(s.runs.id, runId)))[0];
    expect(r.sessionTypeManual).toBe("competicion");
    await unlinkRun(db, id);
    expect((await getRace(db, id))!.runId).toBeNull();
    expect((await db.select().from(s.runs).where(eq(s.runs.id, runId)))[0].sessionTypeManual).toBe("competicion");
  });
  it("vincular sin marcar no cambia el tipo", async () => {
    const id = await saveRace(db, race);
    const runId = await run();
    await linkRun(db, id, runId, false);
    expect((await db.select().from(s.runs).where(eq(s.runs.id, runId)))[0].sessionTypeManual).toBeNull();
  });
  it("si se borra la carrera real, el vínculo se suelta; borrar la objetivo no toca la real", async () => {
    const id = await saveRace(db, race);
    const runId = await run();
    await linkRun(db, id, runId, true);
    await db.delete(s.runs).where(eq(s.runs.id, runId));
    expect((await getRace(db, id))!.runId).toBeNull();
    const id2 = await saveRace(db, race);
    const runId2 = await run();
    await linkRun(db, id2, runId2, false);
    await deleteRace(db, id2);
    expect((await db.select().from(s.runs).where(eq(s.runs.id, runId2)))[0]).toBeTruthy();
  });
});
