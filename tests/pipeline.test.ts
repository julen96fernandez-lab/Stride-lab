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
import { reclassifyAll, setManualType } from "@/lib/analysis/session-type-db";
import { applyInjuryFlags, deleteInjury, saveInjury, listInjuries } from "@/lib/analysis/injuries-db";
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
      workoutsSeen: 10,
      runsFound: 9,
      runsMerged: 1,
      runsTotal: 8,
      runsValid: 6,
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

    // Series con bloques: distancia del reloj (no el calentamiento), sin duplicar.
    const intervalRun = runs.find((r) => r.startAt.toISOString() === "2026-04-03T15:29:27.000Z")!;
    expect(intervalRun.distanceM! / 1000).toBeCloseTo(9.34, 1);
    expect((intervalRun.raw as Record<string, unknown>).distanceFrom).toBe("samples");
    expect(((intervalRun.raw as Record<string, unknown>).distanceStats as unknown[]).length).toBe(1);
    // Entrenamiento partido en dos (42 s): una sola sesión con las dos partes.
    const joined = runs.find((r) => r.startAt.toISOString() === "2026-04-30T08:28:32.000Z")!;
    expect(runs.filter((r) => r.startAt.toISOString().startsWith("2026-04-30"))).toHaveLength(1);
    expect(joined.distanceM! / 1000).toBeCloseTo(8.03, 1);
    expect(joined.durationS).toBe(608 + 2224);
    expect(joined.status).toBe("valid");
    expect(joined.avgHr).toBeNull(); // sin FC media en las estadísticas: no se inventa
    const jz = (await db.select().from(s.runs).where(eq(s.runs.id, joined.id)))[0];
    expect(jz.hrZoneSeconds!.reduce((a, b) => a + b, 0)).toBeGreaterThan(2700); // zonas de las dos partes
    expect(jz.trainingLoad).toBeGreaterThan(0);

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

  it("el tipo manual manda: no lo pisan Reprocesar ni recalcular; volver a automático funciona", async () => {
    const effective = async (id: string) =>
      (await db.execute(sql`SELECT coalesce(session_type_manual, session_type_auto) AS t, session_type_manual AS m, session_type_auto AS a FROM runs WHERE id = ${id}`))
        .rows[0] as { t: string; m: string | null; a: string };
    const startOf = (iso: string) => db.select().from(s.runs).where(eq(s.runs.startAt, new Date(iso)));

    await runImportStep(await newImport(), deps(), Date.now() + 60_000);
    const ref = (await startOf(new Date(REF_START).toISOString()))[0];
    const joined = (await startOf("2026-04-30T08:28:32.000Z"))[0]; // sesión unida
    expect((await effective(ref.id)).a).toBe("tirada_larga");

    await setManualType(db, ref.id, "competicion");
    await setManualType(db, joined.id, "tempo");
    expect((await effective(ref.id)).t).toBe("competicion");

    // «Guardar y recalcular»
    await reclassifyAll(db);
    expect((await effective(ref.id)).t).toBe("competicion");
    expect((await effective(joined.id)).t).toBe("tempo");

    // Reprocesar el zip (nueva importación del mismo archivo)
    await runImportStep(await newImport(), deps(), Date.now() + 60_000);
    const refAfter = (await startOf(new Date(REF_START).toISOString()))[0];
    const joinedAfter = await startOf("2026-04-30T08:28:32.000Z");
    expect(refAfter.id).toBe(ref.id);
    expect(refAfter.sessionTypeManual).toBe("competicion");
    expect(joinedAfter).toHaveLength(1);
    expect(joinedAfter[0].sessionTypeManual).toBe("tempo");

    // Volver a automático: se borra el manual y queda el calculado.
    await setManualType(db, ref.id, null);
    expect(await effective(ref.id)).toMatchObject({ m: null, t: "tirada_larga" });
  });

  it("periodos de lesión abiertos y cerrados marcan las carreras sin borrarlas; esfuerzos calculados", async () => {
    await runImportStep(await newImport(), deps(), Date.now() + 60_000);
    const flagged = async () =>
      ((await db.execute(sql`SELECT to_char(start_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') d FROM runs WHERE in_injury ORDER BY 1`)).rows as { d: string }[]).map((r) => r.d);
    // cerrado: del 15 al 18 de octubre de 2026 → la carrera del 17
    await saveInjury(db, { startDate: "2026-10-15", endDate: "2026-10-18", note: "Gemelo" });
    expect(await flagged()).toEqual(["2026-10-17", "2026-10-17"]); // la de Strava (duplicada) también cae dentro
    // abierto: desde el 19 de octubre → 19 y 20 también
    await saveInjury(db, { startDate: "2026-10-19", endDate: null, note: "Rodilla" });
    expect(await flagged()).toEqual(["2026-10-17", "2026-10-17", "2026-10-19", "2026-10-20"]);
    // cerrar el abierto el día 19
    const open = (await listInjuries(db)).find((i) => i.endDate === null)!;
    await saveInjury(db, { id: open.id, startDate: "2026-10-19", endDate: "2026-10-19", note: "Rodilla" });
    expect(await flagged()).toEqual(["2026-10-17", "2026-10-17", "2026-10-19"]);
    await deleteInjury(db, open.id);
    await applyInjuryFlags(db);
    expect(await flagged()).toEqual(["2026-10-17", "2026-10-17"]);
    // siguen guardadas y visibles
    expect((await db.execute(sql`SELECT count(*)::int n FROM runs WHERE status='valid'`)).rows[0]).toEqual({ n: 6 });

    // Mejores esfuerzos: la carrera de referencia (21,34 km constantes) tiene hasta la media
    const ref = (await db.select().from(s.runs).where(eq(s.runs.startAt, new Date(REF_START))))[0];
    const eff = await db.select().from(s.runEfforts).where(eq(s.runEfforts.runId, ref.id));
    expect(eff.map((e) => e.key).sort()).toEqual(["10k", "1k", "1mi", "5k", "half"]);
    const half = eff.find((e) => e.key === "half")!;
    expect(half.timeS).toBeCloseTo((6101 * 21097.5) / 21340, -1);
  });

  it("reimportar el mismo zip no duplica nada", async () => {
    const a = await newImport();
    await runImportStep(a, deps(), Date.now() + 60_000);
    const b = await newImport();
    await runImportStep(b, deps(), Date.now() + 60_000);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM runs`)).rows as { n: number }[];
    expect(n).toBe(8); // 9 entrenamientos, 2 de ellos unidos en una sesión
    const joined = (await db.execute(sql`SELECT distance_m, duration_s FROM runs WHERE start_at = '2026-04-30T08:28:32Z'`)).rows as { distance_m: number; duration_s: number }[];
    expect(joined).toHaveLength(1);
    expect(joined[0].duration_s).toBe(608 + 2224); // no se suma dos veces al reimportar
    expect(joined[0].distance_m / 1000).toBeCloseTo(8.03, 1);
    const [{ v }] = (await db.execute(sql`SELECT count(*)::int AS v FROM vo2max_readings`)).rows as { v: number }[];
    expect(v).toBe(2);
    const [{ r }] = (await db.execute(sql`SELECT count(*)::int AS r FROM run_routes`)).rows as { r: number }[];
    expect(r).toBe(2);
  });
});
