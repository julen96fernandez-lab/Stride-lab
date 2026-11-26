/**
 * Zapatillas: formulario, km acumulados, límite y aviso (sin base de datos); retirada, habitual,
 * asignación masiva, Reprocesar y sustitución manual → zip (con TEST_DATABASE_URL).
 */
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { parseRange, parseShoe, shoeKm, shoeLabel, shoeUsage, type ShoeInput } from "@/lib/shoes/shoes";
import { assignShoe, bulkAssign, defaultShoeId, deleteShoe, getRunShoe, listShoes, saveShoe, setRetired } from "@/lib/shoes/shoes-db";
import { saveManualRun } from "@/lib/manual/manual-db";
import type { ManualInput } from "@/lib/manual/manual";
import { runImportStep } from "@/lib/import/pipeline";
import { bufferSource } from "@/lib/import/zip";
import { REF_START, buildFixture } from "./helpers/fixture";

const TODAY = "2026-11-26";

describe("formulario de zapatilla", () => {
  it("mínimo: nombre; límite 700 y cinta activada por defecto", () => {
    expect(parseShoe({ name: "  Pegasus  " }, TODAY)).toEqual({
      shoe: { name: "Pegasus", brand: null, model: null, purchasedAt: null, initialKm: 0, limitKm: 700, countTreadmill: true, isDefault: false },
    });
  });
  it("opcionales, coma decimal y casillas", () => {
    const r = parseShoe({ name: "Diarias", brand: "Nike", model: "Pegasus 41", purchasedAt: "2026-03-01", initialKm: "12,5", limitKm: "800", countTreadmill: "", isDefault: "on" }, TODAY);
    expect(r).toEqual({ shoe: { name: "Diarias", brand: "Nike", model: "Pegasus 41", purchasedAt: "2026-03-01", initialKm: 12.5, limitKm: 800, countTreadmill: false, isDefault: true } });
  });
  it("errores claros", () => {
    expect(parseShoe({ name: "" }, TODAY)).toEqual({ error: "Pon un nombre a la zapatilla." });
    expect(parseShoe({ name: "x", purchasedAt: "2026-02-30" }, TODAY)).toEqual({ error: "Fecha de compra no válida." });
    expect(parseShoe({ name: "x", purchasedAt: "2026-12-01" }, TODAY)).toEqual({ error: "La fecha de compra no puede ser futura." });
    expect(parseShoe({ name: "x", initialKm: "-1" }, TODAY)).toHaveProperty("error");
    expect(parseShoe({ name: "x", limitKm: "abc" }, TODAY)).toHaveProperty("error");
    expect(parseShoe({ name: "x", limitKm: "20" }, TODAY)).toEqual({ error: "El límite va de 50 a 10.000 km." });
  });
  it("rango de fechas de la asignación masiva", () => {
    expect(parseRange({ from: "2026-01-01", to: "2026-02-01" })).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(parseRange({ from: "2026-02-01", to: "2026-01-01" })).toHaveProperty("error");
    expect(parseRange({ from: "", to: "2026-01-01" })).toHaveProperty("error");
  });
  it("nombre a mostrar", () => {
    expect(shoeLabel({ name: "Diarias", brand: "Nike", model: "Pegasus" })).toBe("Diarias (Nike Pegasus)");
    expect(shoeLabel({ name: "Diarias", brand: null, model: null })).toBe("Diarias");
  });
});

describe("km acumulados y límite", () => {
  const runs = [
    { distanceM: 10_000, status: "valid", isIndoor: false },
    { distanceM: 5_000, status: "valid", isIndoor: true },
    { distanceM: 8_000, status: "invalid", isIndoor: false },
    { distanceM: 8_000, status: "duplicate", isIndoor: false },
    { distanceM: null, status: "valid", isIndoor: false },
  ];
  it("iniciales + válidas; duplicadas, no válidas y sin distancia no suman", () => {
    expect(shoeKm({ initialKm: 20, countTreadmill: true }, runs)).toEqual({ km: 35, runs: 2 });
  });
  it("sin «Contar carreras en cinta», la cinta no suma", () => {
    expect(shoeKm({ initialKm: 20, countTreadmill: false }, runs)).toEqual({ km: 30, runs: 1 });
  });
  it("aviso suave desde el 80 % y al llegar al límite", () => {
    expect(shoeUsage(559, 700)).toMatchObject({ warn: false, over: false, message: null });
    expect(shoeUsage(560, 700)).toMatchObject({ warn: true, over: false, message: "Está al 80 % de su límite: quedan unos 140 km." });
    expect(shoeUsage(700, 700)).toMatchObject({ warn: true, over: true, leftKm: 0, message: "Ha llegado a su límite de 700 km." });
    expect(shoeUsage(812, 700).pct).toBeCloseTo(1.16, 2);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("zapatillas (base de datos)", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  const putRoute = async (p: string) => `memory://${p}`;
  const { zip } = buildFixture();
  const shoe = (o: Partial<ShoeInput> = {}): ShoeInput => ({
    name: "Diarias", brand: null, model: null, purchasedAt: null, initialKm: 0, limitKm: 700, countTreadmill: true, isDefault: false, ...o,
  });
  const manual = (startAt: string, km: number, isIndoor = false): ManualInput => ({
    startAt: new Date(startAt), distanceM: km * 1000, durationS: km * 330, avgHr: null, maxHr: null, elevationGainM: null,
    cadenceSpm: null, avgPowerW: null, temperatureC: null, sessionType: null, isIndoor,
  });

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
  const view = async (id: string) => (await listShoes(db)).find((x) => x.id === id)!;

  it("km acumulados con las carreras asignadas; quitar la asignación los resta", async () => {
    const id = (await saveShoe(db, shoe({ initialKm: 50 })))!;
    const a = await saveManualRun({ db, putRoute }, manual("2026-11-01T08:00:00Z", 10));
    const b = await saveManualRun({ db, putRoute }, manual("2026-11-03T08:00:00Z", 6, true));
    await assignShoe(db, a, id);
    await assignShoe(db, b, id);
    expect(await view(id)).toMatchObject({ km: 66, runs: 2, assigned: 2 });
    // sin cinta
    await saveShoe(db, shoe({ initialKm: 50, countTreadmill: false }), id);
    expect(await view(id)).toMatchObject({ km: 60, runs: 1, assigned: 2 });
    await assignShoe(db, a, null);
    expect(await view(id)).toMatchObject({ km: 50, runs: 0, assigned: 1 });
  });

  it("límite: aviso desde el 80 %", async () => {
    const id = (await saveShoe(db, shoe({ initialKm: 75, limitKm: 100 })))!;
    expect((await view(id)).usage.warn).toBe(false);
    const a = await saveManualRun({ db, putRoute }, manual("2026-11-01T08:00:00Z", 5));
    await assignShoe(db, a, id);
    expect((await view(id)).usage).toMatchObject({ warn: true, over: false });
    const b = await saveManualRun({ db, putRoute }, manual("2026-11-02T08:00:00Z", 20));
    await assignShoe(db, b, id);
    expect((await view(id)).usage).toMatchObject({ warn: true, over: true });
  });

  it("habitual: solo una; al retirarla deja de serlo y se puede reactivar", async () => {
    const a = (await saveShoe(db, shoe({ name: "A", isDefault: true })))!;
    const b = (await saveShoe(db, shoe({ name: "B", isDefault: true })))!;
    expect(await defaultShoeId(db)).toBe(b);
    expect((await view(a)).isDefault).toBe(false);
    const run = await saveManualRun({ db, putRoute }, manual("2026-11-01T08:00:00Z", 10));
    await assignShoe(db, run, b);
    expect(await setRetired(db, b, "2026-11-20")).toBe(true);
    const v = await view(b);
    expect(v).toMatchObject({ retiredAt: "2026-11-20", isDefault: false, km: 10 });
    expect(await defaultShoeId(db)).toBeNull();
    // retirada al final de la lista; sus carreras siguen con ella
    expect((await listShoes(db)).map((x) => x.name)).toEqual(["A", "B"]);
    expect(await getRunShoe(db, run)).toBe(b);
    await setRetired(db, b, null);
    expect((await view(b)).retiredAt).toBeNull();
  });

  it("borrar la zapatilla quita sus asignaciones pero no las carreras", async () => {
    const id = (await saveShoe(db, shoe()))!;
    const run = await saveManualRun({ db, putRoute }, manual("2026-11-01T08:00:00Z", 10));
    await assignShoe(db, run, id);
    expect(await deleteShoe(db, id)).toBe(true);
    expect(await getRunShoe(db, run)).toBeNull();
    expect((await db.select().from(s.runs).where(eq(s.runs.id, run))).length).toBe(1);
  });

  it("asignación masiva: solo sin zapatilla, salvo «también las que ya tienen otra»; respeta la cinta", async () => {
    const a = (await saveShoe(db, shoe({ name: "A" })))!;
    const b = (await saveShoe(db, shoe({ name: "B", countTreadmill: false })))!;
    const r1 = await saveManualRun({ db, putRoute }, manual("2026-10-31T23:30:00Z", 8)); // 1 nov en Madrid
    const r2 = await saveManualRun({ db, putRoute }, manual("2026-11-05T08:00:00Z", 8));
    const r3 = await saveManualRun({ db, putRoute }, manual("2026-11-07T08:00:00Z", 8, true));
    const out = await saveManualRun({ db, putRoute }, manual("2026-11-12T08:00:00Z", 8));
    await assignShoe(db, r2, a);
    expect(await bulkAssign(db, b, "2026-11-01", "2026-11-10", false)).toBe(1); // r1 (r2 ya tiene, r3 es cinta)
    expect(await getRunShoe(db, r1)).toBe(b);
    expect(await getRunShoe(db, r2)).toBe(a);
    expect(await getRunShoe(db, r3)).toBeNull();
    expect(await getRunShoe(db, out)).toBeNull();
    expect(await bulkAssign(db, b, "2026-11-01", "2026-11-10", true)).toBe(1); // r2 pasa a B
    expect(await getRunShoe(db, r2)).toBe(b);
    expect(await bulkAssign(db, a, "2026-11-01", "2026-11-10", false)).toBe(1); // A cuenta la cinta: r3
    expect(await getRunShoe(db, r3)).toBe(a);
  });

  it("sobrevive a Reprocesar (volver a importar el mismo zip)", async () => {
    await importZip();
    const before = await refRun();
    const id = (await saveShoe(db, shoe()))!;
    await assignShoe(db, before.id, id);
    const kmBefore = (await view(id)).km;
    expect(kmBefore).toBeGreaterThan(0);
    expect((await importZip()).status).toBe("done");
    const after = await refRun();
    expect(after.id).toBe(before.id);
    expect(await getRunShoe(db, after.id)).toBe(id);
    expect((await view(id)).km).toBeCloseTo(kmBefore, 6);
  });

  it("si el zip sustituye a una carrera manual, la zapatilla pasa a la del zip", async () => {
    const id = (await saveShoe(db, shoe()))!;
    const manualId = await saveManualRun({ db, putRoute }, { ...manual(new Date(REF_START + 10 * 60_000).toISOString(), 21.2), durationS: 6100 });
    await assignShoe(db, manualId, id);
    await importZip();
    expect((await db.select().from(s.runs).where(eq(s.runs.id, manualId)))[0]).toBeUndefined();
    const zipRun = await refRun();
    expect(await getRunShoe(db, zipRun.id)).toBe(id);
  });
});
