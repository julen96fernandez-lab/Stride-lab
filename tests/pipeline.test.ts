/**
 * Importación completa del export sintético contra un Postgres local.
 * Requiere TEST_DATABASE_URL (p. ej. postgres://stride:stride@localhost:5432/stride_test).
 */
import { execFileSync } from "node:child_process";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { runImportStep } from "@/lib/import/pipeline";
import { registerImportFromBlob } from "@/lib/import/register";
import { bufferSource } from "@/lib/import/zip";
import { REF_START, buildFixture } from "./helpers/fixture";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("pipeline de importación", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  let { zip } = buildFixture();
  const stored = new Map<string, Buffer>();
  const deps = () => ({
    db,
    source: bufferSource(zip),
    putRoute: async (p: string, body: Buffer) => {
      stored.set(p, body);
      return `memory://${p}`;
    },
  });

  beforeEach(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    await db.execute(sql`TRUNCATE imports, runs, vo2max_readings, app_settings, shoes CASCADE`);
    stored.clear();
  });
  afterAll(() => pool.end());

  async function newImport() {
    const [row] = await db
      .insert(s.imports)
      .values({ blobUrl: "memory://zip", blobPathname: "imports/test.zip", fileSize: zip.length })
      .returning();
    return row.id;
  }

  async function checkResults(importId: string) {
    const imp = (await db.select().from(s.imports).where(eq(s.imports.id, importId)))[0];
    expect(imp.error).toBeNull();
    expect(imp.status).toBe("done");
    expect(imp.stats).toMatchObject({
      workoutsSeen: 7,
      runsFound: 6,
      runsTotal: 6,
      runsValid: 4,
      runsInvalid: 1,
      runsDuplicate: 1,
      runsSpecial: 1,
      vo2Readings: 2,
      routesLinked: 1,
      routesTimeLinked: 1,
    });
    expect(imp.exportDate?.toISOString()).toBe("2026-11-16T20:00:00.000Z");

    const runs = await db.select().from(s.runs).orderBy(asc(s.runs.startAt));
    const ref = runs.find((r) => r.startAt.getTime() === REF_START)!;
    expect(ref.distanceM).toBeCloseTo(21340, 0);
    expect(Math.round(ref.durationS)).toBe(6101);
    expect(Math.round(ref.avgPaceSPerKm!)).toBe(286); // 4:46
    expect(ref.avgHr).toBe(156);
    expect(ref.avgPowerW).toBe(252);
    expect(ref.status).toBe("valid");

    // Series: solo muestras del reloj (no las del iPhone).
    const series = await db.select().from(s.runSeries).where(eq(s.runSeries.runId, ref.id));
    const dist = series.find((x) => x.metric === "distance")!;
    expect(dist.v.reduce((a, b) => a + b, 0)).toBeCloseTo(21340, 0);
    expect(series.find((x) => x.metric === "hr")!.v.every((v) => v === 150 || v === 162)).toBe(true);

    // Parciales: 21 km completos + 340 m, basados en la distancia del reloj.
    const splits = await db.select().from(s.runSplits).where(eq(s.runSplits.runId, ref.id)).orderBy(asc(s.runSplits.idx));
    expect(splits).toHaveLength(22);
    expect(splits[0].basis).toBe("samples");
    expect(Math.round(splits[0].paceSPerKm!)).toBe(286);
    expect(splits[0].avgHr).toBe(150);
    expect(splits[20].avgHr).toBe(162);
    expect(splits[21].distanceM).toBeCloseTo(340, 0);

    // Ruta: original guardado y polyline.
    const route = (await db.select().from(s.runRoutes).where(eq(s.runRoutes.runId, ref.id)))[0];
    expect(route.blobUrl).toBe(`memory://routes/${ref.id}.gpx`);
    expect(route.polyline!.length).toBeGreaterThan(4);
    expect(stored.has(`routes/${ref.id}.gpx`)).toBe(true);

    // Cinta: parciales desde la distancia del reloj, sin ruta.
    const indoor = runs.find((r) => r.isIndoor)!;
    expect(await db.select().from(s.runRoutes).where(eq(s.runRoutes.runId, indoor.id))).toHaveLength(0);
    expect(await db.select().from(s.runSplits).where(eq(s.runSplits.runId, indoor.id))).toHaveLength(8);

    // 2016: distancia del atributo antiguo y GPX enlazado por hora.
    const old = runs[0];
    expect(old.startAt.getUTCFullYear()).toBe(2016);
    expect(old.distanceM).toBe(10000);
    expect(old.routeFile).toBe("route_2016-05-10_9.25am.gpx");
    const oldSplits = await db.select().from(s.runSplits).where(eq(s.runSplits.runId, old.id));
    expect(oldSplits[0].basis).toBe("gpx");

    const strava = runs.find((r) => r.source === "strava")!;
    expect(strava).toMatchObject({ status: "duplicate", duplicateOf: ref.id });

    const vo2 = await db.select().from(s.vo2maxReadings).orderBy(asc(s.vo2maxReadings.measuredAt));
    expect(vo2.map((v) => v.value)).toEqual([60.1, 50.8]);

    expect(await db.select().from(s.importSamples)).toHaveLength(0);

    // Tipos de sesión automáticos: cinta para la indoor; las no válidas sin tipo.
    expect(indoor.sessionTypeAuto ?? (await db.select().from(s.runs).where(eq(s.runs.id, indoor.id)))[0].sessionTypeAuto).toBe("cinta");
    // Zonas (FC 150 → Z3, 162 → Z4 con 181/46) y carga de la carrera de referencia.
    const refNow = (await db.select().from(s.runs).where(eq(s.runs.id, ref.id)))[0];
    expect(refNow.hrZoneSeconds).toHaveLength(5);
    expect(refNow.hrZoneSeconds![2]).toBeGreaterThan(2900);
    expect(refNow.hrZoneSeconds![3]).toBeGreaterThan(2900);
    expect(refNow.trainingLoad).toBeGreaterThan(300);
    const typed = await db.select({ st: s.runs.status, t: s.runs.sessionTypeAuto }).from(s.runs);
    expect(typed.filter((x) => x.st === "valid").every((x) => x.t !== null)).toBe(true);
    expect(typed.filter((x) => x.st !== "valid").every((x) => x.t === null)).toBe(true);
  }

  it("importa todo en una sola invocación", async () => {
    const id = await newImport();
    await runImportStep(id, deps(), Date.now() + 60_000);
    await checkResults(id);
  });

  it("reanuda tras cortes en cualquier punto y da el mismo resultado", async () => {
    const id = await newImport();
    // Reloj falso: cada consulta a now() avanza 1 s; cada invocación dura 3 s.
    let clock = 0;
    const now = () => (clock += 1000);
    let steps = 0;
    for (;;) {
      const row = await runImportStep(id, { ...deps(), now }, clock + 3000);
      steps++;
      if (process.env.DEBUG_STEPS) console.log(steps, row.phase, row.status, row.bytesProcessed, JSON.stringify(row.state).slice(0, 80));
      if (row.status === "done" || row.status === "failed" || steps > 500) break;
    }
    expect(steps).toBeGreaterThan(5);
    await checkResults(id);
  });

  it("reanuda a mitad de un XML de varios MB", async () => {
    zip = buildFixture({ filler: 40_000 }).zip;
    try {
      const id = await newImport();
      let clock = 0;
      const now = () => (clock += 1000);
      let steps = 0;
      const offsets = new Set<number>();
      for (;;) {
        const row = await runImportStep(id, { ...deps(), now }, clock + 2000);
        offsets.add(row.bytesProcessed);
        if (process.env.DEBUG_STEPS) console.log(steps, row.phase, row.bytesProcessed, row.bytesTotal);
        if (row.status === "done" || row.status === "failed" || ++steps > 500) break;
      }
      expect(offsets.size).toBeGreaterThan(10); // muchos puntos de control intermedios
      await checkResults(id);
    } finally {
      zip = buildFixture().zip;
    }
  });

  it("no procesa si otra invocación tiene la reserva", async () => {
    const id = await newImport();
    await db.execute(sql`UPDATE imports SET lease_until = now() + interval '5 minutes' WHERE id = ${id}`);
    const row = await runImportStep(id, deps(), Date.now() + 60_000);
    expect(row.phase).toBe("index");
    expect(row.status).toBe("uploaded");
  });

  it("crea la importación desde un zip ya subido y reutiliza la que esté a medias", async () => {
    const blob = { url: "memory://imports/a.zip", pathname: "imports/a.zip", size: zip.length };
    const a = await registerImportFromBlob(db, blob, "exportar.zip");
    expect(a.reused).toBe(false);
    expect(a.row).toMatchObject({ status: "uploaded", fileSize: zip.length, fileName: "exportar.zip" });
    const again = await registerImportFromBlob(db, blob, "exportar.zip");
    expect(again).toMatchObject({ reused: true, row: { id: a.row.id } });
    await runImportStep(a.row.id, deps(), Date.now() + 60_000);
    const fresh = await registerImportFromBlob(db, blob, "exportar.zip"); // la anterior terminó
    expect(fresh.reused).toBe(false);
  });

  it("reimportar el mismo zip no duplica nada", async () => {
    const a = await newImport();
    await runImportStep(a, deps(), Date.now() + 60_000);
    const b = await newImport();
    await runImportStep(b, deps(), Date.now() + 60_000);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM runs`)).rows as { n: number }[];
    expect(n).toBe(6);
    const [{ v }] = (await db.execute(sql`SELECT count(*)::int AS v FROM vo2max_readings`)).rows as { v: number }[];
    expect(v).toBe(2);
    const [{ r }] = (await db.execute(sql`SELECT count(*)::int AS r FROM run_routes`)).rows as { r: number }[];
    expect(r).toBe(2);
  });
});
