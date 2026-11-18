/**
 * Sensaciones: validación (sin base de datos) y guardado, edición, borrado, Reprocesar y
 * sustitución manual → zip (con TEST_DATABASE_URL).
 */
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { isEmptyFeeling, parseFeeling } from "@/lib/feelings/feelings";
import { deleteFeeling, getFeeling, saveFeeling } from "@/lib/feelings/feelings-db";
import { saveManualRun } from "@/lib/manual/manual-db";
import type { ManualInput } from "@/lib/manual/manual";
import { runImportStep } from "@/lib/import/pipeline";
import { bufferSource } from "@/lib/import/zip";
import { REF_START, buildFixture } from "./helpers/fixture";

describe("validación de la sensación", () => {
  it("valoración de 1 a 5 o vacía", () => {
    expect(parseFeeling({ rating: 4 })).toEqual({ feeling: { rating: 4, note: null, tags: [] } });
    expect(parseFeeling({ rating: "" })).toEqual({ feeling: { rating: null, note: null, tags: [] } });
    expect(parseFeeling({ rating: 0 })).toEqual({ error: "La valoración va de 1 a 5." });
    expect(parseFeeling({ rating: 6 })).toHaveProperty("error");
    expect(parseFeeling({ rating: 3.5 })).toHaveProperty("error");
  });
  it("nota recortada y como mucho 500 caracteres", () => {
    expect(parseFeeling({ note: "  Buen ritmo  " })).toEqual({ feeling: { rating: null, note: "Buen ritmo", tags: [] } });
    expect(parseFeeling({ note: "   " })).toEqual({ feeling: { rating: null, note: null, tags: [] } });
    expect(parseFeeling({ note: "x".repeat(500) })).not.toHaveProperty("error");
    expect(parseFeeling({ note: "x".repeat(501) })).toEqual({ error: "La nota admite hasta 500 caracteres." });
  });
  it("etiquetas: solo las de la lista, sin repetir y en orden fijo", () => {
    expect(parseFeeling({ tags: ["viento", "calor", "calor"] })).toEqual({ feeling: { rating: null, note: null, tags: ["calor", "viento"] } });
    expect(parseFeeling({ tags: ["lluvia"] })).toEqual({ error: "Etiqueta no válida." });
  });
  it("vacía = sin valoración, nota ni etiquetas", () => {
    expect(isEmptyFeeling({ rating: null, note: null, tags: [] })).toBe(true);
    expect(isEmptyFeeling({ rating: null, note: null, tags: ["calor"] })).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("sensaciones (base de datos)", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  const putRoute = async (p: string) => `memory://${p}`;
  const { zip } = buildFixture();

  beforeEach(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    await db.execute(sql`TRUNCATE imports, runs, vo2max_readings, app_settings, shoes CASCADE`);
  });
  afterAll(() => pool.end());

  async function importZip() {
    const [row] = await db.insert(s.imports).values({ blobUrl: "memory://zip", blobPathname: "imports/test.zip", fileSize: zip.length }).returning();
    await runImportStep(row.id, { db, source: bufferSource(zip), putRoute }, Date.now() + 60_000);
    return (await db.select().from(s.imports).where(eq(s.imports.id, row.id)))[0];
  }
  const refRun = async () => (await db.select().from(s.runs).where(eq(s.runs.startAt, new Date(REF_START))))[0];

  it("guardar, editar y borrar", async () => {
    await importZip();
    const run = await refRun();
    expect(await getFeeling(db, run.id)).toBeNull();
    expect(await saveFeeling(db, run.id, { rating: 2, note: "Piernas cargadas", tags: ["piernas_pesadas", "calor"] })).toBe("saved");
    expect(await getFeeling(db, run.id)).toEqual({ rating: 2, note: "Piernas cargadas", tags: ["piernas_pesadas", "calor"] });
    await saveFeeling(db, run.id, { rating: 4, note: null, tags: ["buen_dia"] });
    expect(await getFeeling(db, run.id)).toEqual({ rating: 4, note: null, tags: ["buen_dia"] });
    // si se vacía, se borra
    expect(await saveFeeling(db, run.id, { rating: null, note: null, tags: [] })).toBe("deleted");
    expect(await getFeeling(db, run.id)).toBeNull();
    await saveFeeling(db, run.id, { rating: 5, note: "Genial", tags: [] });
    await deleteFeeling(db, run.id);
    expect(await getFeeling(db, run.id)).toBeNull();
  });

  it("sobrevive a Reprocesar (volver a importar el mismo zip): la carrera conserva su id", async () => {
    await importZip();
    const before = await refRun();
    await saveFeeling(db, before.id, { rating: 3, note: "Media con viento", tags: ["viento"] });
    const again = await importZip();
    expect(again.status).toBe("done");
    const after = await refRun();
    expect(after.id).toBe(before.id);
    expect(await getFeeling(db, after.id)).toEqual({ rating: 3, note: "Media con viento", tags: ["viento"] });
  });

  it("si el zip sustituye a una carrera manual, la sensación pasa a la del zip", async () => {
    const input: ManualInput = {
      startAt: new Date(REF_START + 10 * 60_000), distanceM: 21200, durationS: 6100, avgHr: null, maxHr: null, elevationGainM: null,
      cadenceSpm: null, avgPowerW: null, temperatureC: null, sessionType: "competicion", isIndoor: false,
    };
    const manualId = await saveManualRun({ db, putRoute }, input);
    await saveFeeling(db, manualId, { rating: 5, note: "Media de Bilbao", tags: ["buen_dia"] });
    await importZip();
    expect((await db.select().from(s.runs).where(eq(s.runs.id, manualId)))[0]).toBeUndefined();
    const zipRun = await refRun();
    expect(await getFeeling(db, zipRun.id)).toEqual({ rating: 5, note: "Media de Bilbao", tags: ["buen_dia"] });
  });

  it("al borrar la carrera se borra su sensación", async () => {
    const manualId = await saveManualRun({ db, putRoute }, {
      startAt: new Date("2026-11-01T09:00:00Z"), distanceM: 8000, durationS: 2600, avgHr: null, maxHr: null, elevationGainM: null,
      cadenceSpm: null, avgPowerW: null, temperatureC: null, sessionType: null, isIndoor: false,
    });
    await saveFeeling(db, manualId, { rating: 4, note: null, tags: [] });
    await db.delete(s.runs).where(eq(s.runs.id, manualId));
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM run_feelings`)).rows as { n: number }[];
    expect(n).toBe(0);
  });
});
