/**
 * «Revisar datos de salud»: recuento puro y, con TEST_DATABASE_URL, la revisión completa sobre
 * el zip de prueba (solo cuenta: no cambia nada más; igual en una pasada que en muchas).
 */
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { addReading, addStep, newCensus, sourceKind, summarizeCensus } from "@/lib/health/census";
import { runHealthScanStep, startHealthScan, toHealthScanView } from "@/lib/health/census-run";
import { runImportStep } from "@/lib/import/pipeline";
import { bufferSource } from "@/lib/import/zip";
import { buildFixture } from "./helpers/fixture";

const D = (iso: string) => new Date(iso);

describe("recuento de datos de salud", () => {
  it("fuente: Watch, iPhone u otra", () => {
    expect(sourceKind("Apple Watch de Ana")).toBe("watch");
    expect(sourceKind("iPhone de Ana")).toBe("phone");
    expect(sourceKind("Oura")).toBe("other");
    expect(sourceKind(null)).toBe("other");
  });

  it("lecturas, fechas (Madrid) y días del Watch, con los últimos 28 días", () => {
    const c = newCensus();
    addReading(c, "hrv", { sourceName: "Apple Watch", start: D("2026-10-01T22:30:00Z"), end: null }); // 2 oct en Madrid
    addReading(c, "hrv", { sourceName: "Apple Watch", start: D("2026-11-10T06:00:00Z"), end: null });
    addReading(c, "hrv", { sourceName: "Apple Watch", start: D("2026-11-10T15:00:00Z"), end: null });
    addReading(c, "hrv", { sourceName: "iPhone", start: D("2026-11-12T06:00:00Z"), end: null });
    const sum = summarizeCensus(c, "2026-11-16", 0).kinds.find((k) => k.kind === "hrv")!;
    expect(sum).toMatchObject({ total: 4, watch: 3, phone: 1, other: 0, first: "2026-10-02", last: "2026-11-12", watchDays: 2, last28: 1 });
  });

  it("sueño: el día es el del final y las fases solo del Watch", () => {
    const c = newCensus();
    addReading(c, "sleep", { sourceName: "Apple Watch", start: D("2026-11-10T22:30:00Z"), end: D("2026-11-11T05:00:00Z"), value: "HKCategoryValueSleepAnalysisAsleepCore" });
    addReading(c, "sleep", { sourceName: "Apple Watch", start: D("2026-11-11T05:00:00Z"), end: D("2026-11-11T06:00:00Z"), value: "HKCategoryValueSleepAnalysisAsleepREM" });
    addReading(c, "sleep", { sourceName: "iPhone", start: D("2026-11-10T22:00:00Z"), end: D("2026-11-11T06:30:00Z"), value: "HKCategoryValueSleepAnalysisInBed" });
    const sum = summarizeCensus(c, "2026-11-16", 0);
    expect(sum.kinds.find((k) => k.kind === "sleep")).toMatchObject({ total: 3, watch: 2, phone: 1, first: "2026-11-11", watchDays: 1 });
    expect(sum.sleepStages).toEqual([
      { stage: "AsleepCore", label: "Núcleo", n: 1 },
      { stage: "AsleepREM", label: "REM", n: 1 },
    ]);
  });

  it("días con los tres datos a la vez", () => {
    const c = newCensus();
    const w = { sourceName: "Apple Watch", end: null };
    for (const k of ["hrv", "resting"] as const) addReading(c, k, { ...w, start: D("2026-11-10T08:00:00Z") });
    addReading(c, "sleep", { ...w, start: D("2026-11-09T23:00:00Z"), end: D("2026-11-10T06:00:00Z") });
    addReading(c, "hrv", { ...w, start: D("2026-11-11T08:00:00Z") });
    expect(summarizeCensus(c, "2026-11-16", 0)).toMatchObject({ allThreeDays: 1, allThreeLast28: 1 });
  });

  it("pasos: carreras con pasos y cada cuánto llegan (mediana por carrera)", () => {
    const c = newCensus();
    for (let t = 0; t < 600; t += 5) addStep(c, "a", t);
    for (const t of [0, 40, 80, 200]) addStep(c, "b", t);
    addStep(c, "c", 0); // un solo registro: sin intervalo
    const st = summarizeCensus(c, "2026-11-16", 10).steps;
    expect(st).toMatchObject({ runsTotal: 10, runsWithSteps: 3, samples: 125 });
    expect(st.medianGapS).toBe(22.5); // medianas 5 y 40
    expect(st.byGap.map((b) => b.runs)).toEqual([1, 0, 1, 0]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("revisión de datos de salud sobre el zip guardado (base de datos)", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  const putRoute = async (p: string) => `memory://${p}`;
  const { zip } = buildFixture({ health: true, filler: 30_000 });

  beforeEach(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    await db.execute(sql`TRUNCATE imports, runs, vo2max_readings, app_settings, shoes, health_scans CASCADE`);
    const [row] = await db.insert(s.imports).values({ blobUrl: "memory://zip", blobPathname: "imports/test.zip", fileSize: zip.length }).returning();
    await runImportStep(row.id, { db, source: bufferSource(zip), putRoute }, Date.now() + 120_000);
  });
  afterAll(() => pool.end());

  const snapshot = async () =>
    (
      await db.execute(sql`SELECT
        (SELECT count(*) FROM runs)::int AS runs, (SELECT count(*) FROM run_series)::int AS series,
        (SELECT count(*) FROM run_splits)::int AS splits, (SELECT count(*) FROM vo2max_readings)::int AS vo2,
        (SELECT count(*) FROM imports)::int AS imports, (SELECT coalesce(sum(cadence_spm), 0)::float AS cad FROM runs)::float AS cad,
        (SELECT max(updated_at) FROM runs) AS touched`)
    ).rows[0];

  it("cuenta lo que trae el zip y no cambia nada más", async () => {
    const before = await snapshot();
    const scan = (await startHealthScan(db))!;
    const done = await runHealthScanStep(scan.id, { db, source: bufferSource(zip) }, Date.now() + 120_000);
    expect(done.status).toBe("done");
    const v = await toHealthScanView(db, done);
    const k = Object.fromEntries(v.summary!.kinds.map((x) => [x.kind, x]));
    expect(k.hrv).toMatchObject({ total: 4, watch: 3, other: 1, watchDays: 2 });
    expect(k.resting).toMatchObject({ total: 2, watch: 2, watchDays: 2 });
    expect(k.sleep).toMatchObject({ total: 6, watch: 5, phone: 1, watchDays: 1, first: "2026-11-11" });
    expect(k.wristTemp).toMatchObject({ total: 0 });
    expect(v.summary!.sleepStages.find((x) => x.stage === "AsleepCore")?.n).toBe(2);
    expect(v.summary!.allThreeDays).toBe(1); // el 11 nov
    // Pasos: solo los del Watch dentro de la carrera de referencia, cada 20 s.
    expect(v.summary!.steps).toMatchObject({ runsWithSteps: 1, samples: 306, medianGapS: 20 });
    // Nada más ha cambiado.
    expect(await snapshot()).toEqual(before);
  });

  it("por tramos da lo mismo que de una vez (reanudable)", async () => {
    const one = (await startHealthScan(db))!;
    const a = await runHealthScanStep(one.id, { db, source: bufferSource(zip) }, Date.now() + 120_000);
    const sumA = (await toHealthScanView(db, a)).summary;

    const two = (await startHealthScan(db))!;
    expect(two.id).not.toBe(one.id); // la anterior ya terminó: empieza otra
    let steps = 0;
    let row = two;
    while (row.status !== "done" && steps < 200) {
      row = await runHealthScanStep(two.id, { db, source: bufferSource(zip) }, 0); // se corta en cada tramo
      steps++;
    }
    expect(row.status).toBe("done");
    expect(steps).toBeGreaterThan(1);
    expect((await toHealthScanView(db, row)).summary).toEqual(sumA);
  });

  it("si hay una a medias la continúa en vez de empezar otra", async () => {
    const a = (await startHealthScan(db))!;
    await runHealthScanStep(a.id, { db, source: bufferSource(zip) }, 0);
    const b = (await startHealthScan(db))!;
    expect(b.id).toBe(a.id);
    expect((await db.select().from(s.healthScans).where(eq(s.healthScans.id, a.id)))[0].status).not.toBe("done");
  });
});
