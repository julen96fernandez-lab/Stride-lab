/**
 * Carreras añadidas a mano: validación, cálculos, sustitución por el zip y flujo completo
 * contra Postgres (TEST_DATABASE_URL).
 */
import { execFileSync } from "node:child_process";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { dateToMadrid, isSameRun, madridToDate, manualDerived, matchManualRuns, parseManualForm, type ManualInput } from "@/lib/manual/manual";
import { deleteManualRun, findDuplicates, previewManual, saveManualRun } from "@/lib/manual/manual-db";
import { runImportStep } from "@/lib/import/pipeline";
import { bufferSource } from "@/lib/import/zip";
import { REF_START, buildFixture } from "./helpers/fixture";

const NOW = new Date("2026-11-18T12:00:00Z");
const form = (o: Record<string, string> = {}) => ({ date: "2026-11-15", time: "09:30", distanceKm: "10,5", h: "0", m: "52", s: "30", ...o });

describe("formulario de carrera manual", () => {
  it("mínimo: fecha, hora, distancia y duración; todo lo demás vacío", () => {
    const { input, errors } = parseManualForm(form(), NOW);
    expect(errors).toEqual({});
    expect(input).toMatchObject({ distanceM: 10500, durationS: 3150, avgHr: null, sessionType: null, isIndoor: false, note: null });
    expect(input!.startAt.toISOString()).toBe("2026-11-15T08:30:00.000Z"); // 09:30 en Madrid (invierno)
  });

  it("hora de Madrid con horario de verano y vuelta al formulario", () => {
    const d = madridToDate("2026-07-04", "09:59")!;
    expect(d.toISOString()).toBe("2026-07-04T07:59:00.000Z");
    expect(dateToMadrid(d)).toEqual({ date: "2026-07-04", time: "09:59" });
  });

  it("opcionales y tipo elegido a mano", () => {
    const { input } = parseManualForm(form({ avgHr: "152", maxHr: "171", elevationGainM: "85", cadenceSpm: "172", avgPowerW: "250", temperatureC: "14,5", sessionType: "tempo", note: " Con viento ", isIndoor: "on" }), NOW);
    expect(input).toMatchObject({ avgHr: 152, maxHr: 171, elevationGainM: 85, cadenceSpm: 172, avgPowerW: 250, temperatureC: 14.5, sessionType: "tempo", note: "Con viento", isIndoor: true });
  });

  it("errores claros en español", () => {
    const e = (o: Record<string, string>) => parseManualForm(form(o), NOW).errors;
    expect(e({ distanceKm: "" }).distanceM).toMatch(/distancia/);
    expect(e({ distanceKm: "diez" }).distanceM).toMatch(/distancia/);
    expect(e({ h: "0", m: "0", s: "0" }).duration).toMatch(/duración/);
    expect(e({ m: "75" }).duration).toMatch(/minutos/);
    expect(e({ distanceKm: "42", m: "30", s: "0" }).duration).toMatch(/Ritmo imposible/);
    expect(e({ date: "2026-12-01" }).date).toMatch(/futuro/);
    expect(e({ date: "" }).date).toMatch(/fecha/);
    expect(e({ avgHr: "160", maxHr: "150" }).maxHr).toMatch(/máximo/);
    expect(e({ avgHr: "300" }).avgHr).toMatch(/Pulso medio/);
    expect(e({ sessionType: "fartlek" }).sessionType).toBeTruthy();
  });

  it("ritmo, sesión especial y validez con las reglas de siempre", () => {
    expect(manualDerived({ distanceM: 10000, durationS: 3000 })).toMatchObject({ paceSPerKm: 300, isSpecial: false, status: "valid" });
    expect(manualDerived({ distanceM: 3000, durationS: 1800 })).toMatchObject({ isSpecial: true }); // 10:00 /km
    expect(manualDerived({ distanceM: 400, durationS: 120 })).toMatchObject({ status: "invalid", invalidReason: "menos_de_0_5_km" });
  });
});

describe("regla de sustitución por el zip", () => {
  const m = { id: "m", startAt: new Date("2026-11-15T08:30:00Z"), distanceM: 10000 };
  it("mismo día, inicio a < 30 min y distancia ±5 %", () => {
    expect(isSameRun(m, { id: "z", startAt: new Date("2026-11-15T08:45:00Z"), distanceM: 10400 })).toBe(true);
    expect(isSameRun(m, { id: "z", startAt: new Date("2026-11-15T09:00:00Z"), distanceM: 10000 })).toBe(false); // 30 min justos
    expect(isSameRun(m, { id: "z", startAt: new Date("2026-11-15T08:35:00Z"), distanceM: 10600 })).toBe(false); // +6 %
    // 23:50 y 00:10 en Madrid: 20 min, pero distinto día
    const late = { id: "l", startAt: new Date("2026-11-15T22:50:00Z"), distanceM: 5000 };
    expect(isSameRun(late, { id: "z", startAt: new Date("2026-11-15T23:10:00Z"), distanceM: 5000 })).toBe(false);
  });
  it("cada carrera del zip sustituye como mucho a una manual; gana la más cercana", () => {
    const zip = [
      { id: "far", startAt: new Date("2026-11-15T08:55:00Z"), distanceM: 10000 },
      { id: "near", startAt: new Date("2026-11-15T08:32:00Z"), distanceM: 10100 },
    ];
    expect([...matchManualRuns([m], zip)]).toEqual([["m", "near"]]);
    expect(matchManualRuns([m, { ...m, id: "m2" }], [zip[1]]).size).toBe(1);
  });
});

// ─── Con base de datos ───────────────────────────────────────────────────────

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

/** GPX de 5 km a ~4:59 /km con pulso, empezando en `start`. */
function gpx(start: number, n = 500) {
  const pts = Array.from({ length: n }, (_, i) => {
    const lat = 43 + (i * 10.03) / 111_195; // ~10 m cada 3 s
    return `<trkpt lat="${lat.toFixed(7)}" lon="-3"><ele>${(30 + 5 * Math.sin(i / 40)).toFixed(1)}</ele><time>${new Date(start + i * 3000).toISOString()}</time><extensions><gpxtpx:hr>${145 + (i % 6)}</gpxtpx:hr></extensions></trkpt>`;
  });
  return new TextEncoder().encode(`<gpx><trk><trkseg>${pts.join("")}</trkseg></trk></gpx>`);
}

d("carreras manuales (base de datos)", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: s }) as unknown as Db;
  const stored = new Map<string, Buffer>();
  const putRoute = async (p: string, body: Buffer) => {
    stored.set(p, body);
    return `memory://${p}`;
  };
  const { zip } = buildFixture();

  beforeEach(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
    await db.execute(sql`TRUNCATE imports, runs, vo2max_readings, app_settings, shoes CASCADE`);
    stored.clear();
  });
  afterAll(() => pool.end());

  const input = (o: Partial<ManualInput> = {}): ManualInput => ({
    startAt: new Date("2026-11-15T08:30:00Z"),
    distanceM: 10000,
    durationS: 3000,
    avgHr: null,
    maxHr: null,
    elevationGainM: null,
    cadenceSpm: null,
    avgPowerW: null,
    temperatureC: null,
    sessionType: null,
    note: null,
    isIndoor: false,
    ...o,
  });
  const get = async (id: string) => (await db.select().from(s.runs).where(eq(s.runs.id, id)))[0];
  const count = async (table: string, id: string) =>
    ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE run_id = '${id}'`))).rows[0] as { n: number }).n;

  async function importZip() {
    const [row] = await db.insert(s.imports).values({ blobUrl: "memory://zip", blobPathname: "imports/test.zip", fileSize: zip.length }).returning();
    await runImportStep(row.id, { db, source: bufferSource(zip), putRoute }, Date.now() + 60_000);
    return (await db.select().from(s.imports).where(eq(s.imports.id, row.id)))[0];
  }

  it("mínima sin pulso: ritmo, tipo automático; sin series, zonas ni carga (no se inventa)", async () => {
    const id = await saveManualRun({ db, putRoute }, input());
    const r = await get(id);
    expect(r).toMatchObject({ source: "manual", sourceName: "Manual", status: "valid", isSpecial: false, hrZoneSeconds: null, trainingLoad: null, loadEstimated: false });
    expect(r.avgPaceSPerKm).toBe(300);
    expect(r.sessionTypeAuto).toBeTruthy();
    expect(r.sessionTypeManual).toBeNull();
    expect(await count("run_series", id)).toBe(0);
    expect(await count("run_routes", id)).toBe(0);
    expect(await count("run_efforts", id)).toBe(0);
  });

  it("con pulso medio: carga estimada y marcada; sobrevive a un recálculo general", async () => {
    const id = await saveManualRun({ db, putRoute }, input({ avgHr: 150 }));
    const r = await get(id);
    expect(r.loadEstimated).toBe(true);
    expect(r.trainingLoad).toBeGreaterThan(0);
    expect(r.hrZoneSeconds).toBeNull(); // sin muestras: no hay tiempo en zonas
    const { reclassifyAll } = await import("@/lib/analysis/session-type-db");
    await reclassifyAll(db);
    expect((await get(id)).trainingLoad).toBeCloseTo(r.trainingLoad!, 3);
  });

  it("con archivo GPX: series, ruta, pista, parciales, zonas, carga real y récords", async () => {
    const start = Date.parse("2026-11-12T17:00:00Z");
    const id = await saveManualRun({ db, putRoute }, input({ startAt: new Date(start), distanceM: 5000, durationS: 1497 }), { file: { name: "strava.gpx", bytes: gpx(start) } });
    const r = await get(id);
    expect(r.loadEstimated).toBe(false);
    expect(r.hrZoneSeconds!.reduce((a, b) => a + b, 0)).toBeGreaterThan(1400);
    expect(r.trainingLoad).toBeGreaterThan(0);
    expect(r.routeFile).toBe("strava.gpx");
    expect(await count("run_series", id)).toBe(2); // distancia y pulso
    expect(await count("run_routes", id)).toBe(1);
    expect(await count("run_tracks", id)).toBe(1);
    expect(await count("run_splits", id)).toBe(5);
    const eff = await db.select().from(s.runEfforts).where(eq(s.runEfforts.runId, id));
    expect(eff.map((e) => e.key).sort()).toEqual(["1k", "1mi", "5k"]); // 499 × 10,03 m ≈ 5,005 km
    expect(stored.has(`routes/${id}.gpx`)).toBe(true);
  });

  it("duplicado: avisa en la vista previa de otra carrera a ≤ 30 min", async () => {
    const a = await saveManualRun({ db, putRoute }, input());
    const p = await previewManual(db, input({ startAt: new Date("2026-11-15T08:50:00Z") }));
    expect(p.duplicates.map((x) => x.id)).toEqual([a]);
    expect((await findDuplicates(db, new Date("2026-11-15T09:10:00Z"))).length).toBe(0);
    expect(p).toMatchObject({ paceSPerKm: 300, isSpecial: false, typeIsManual: false });
    // Editando la misma carrera no se avisa de sí misma.
    expect((await previewManual(db, input(), null, a)).duplicates).toEqual([]);
  });

  it("edición y borrado solo de las manuales", async () => {
    const id = await saveManualRun({ db, putRoute }, input({ note: "uno" }));
    await saveManualRun({ db, putRoute }, input({ distanceM: 12000, note: "dos", sessionType: "tirada_larga" }), { id });
    const r = await get(id);
    expect(r).toMatchObject({ distanceM: 12000, note: "dos", sessionTypeManual: "tirada_larga" });
    expect(r.avgPaceSPerKm).toBe(250);
    // Una importada no se edita ni se borra.
    await importZip();
    const imported = (await db.select().from(s.runs).where(eq(s.runs.startAt, new Date(REF_START))))[0];
    await expect(saveManualRun({ db, putRoute }, input(), { id: imported.id })).rejects.toThrow(/añadidas a mano/);
    expect(await deleteManualRun(db, imported.id)).toBe(false);
    expect(await get(imported.id)).toBeTruthy();
    expect(await deleteManualRun(db, id)).toBe(true);
    expect(await get(id)).toBeUndefined();
  });

  it("el zip sustituye a la manual que coincide (conserva tipo y nota) y deja la que no", async () => {
    // La del 17-oct (21,34 km a las 09:00 de Madrid) añadida a mano 10 min tarde y con 21,2 km.
    const twin = await saveManualRun(
      { db, putRoute },
      input({ startAt: new Date(REF_START + 10 * 60_000), distanceM: 21200, durationS: 6100, sessionType: "competicion", note: "Media de Bilbao" }),
    );
    const alone = await saveManualRun({ db, putRoute }, input({ startAt: new Date("2026-11-01T09:00:00Z"), note: "sin pareja" }));
    // Misma hora que otra del zip pero distancia muy distinta: no es la misma.
    const near = await saveManualRun({ db, putRoute }, input({ startAt: new Date(Date.parse("2026-10-18T08:00:00Z") + 5 * 60_000), distanceM: 30000, durationS: 9000 }));

    const imp = await importZip();
    expect(imp.status).toBe("done");
    expect((imp.stats as Record<string, number>).manualReplaced).toBe(1);

    expect(await get(twin)).toBeUndefined();
    const ref = (await db.select().from(s.runs).where(eq(s.runs.startAt, new Date(REF_START))))[0];
    expect(ref).toMatchObject({ source: "apple_watch", sessionTypeManual: "competicion", note: "Media de Bilbao" });
    expect(await count("run_series", ref.id)).toBeGreaterThan(0); // datos completos del zip

    expect(await get(alone)).toMatchObject({ status: "valid", note: "sin pareja" });
    expect(await get(near)).toMatchObject({ status: "valid", duplicateOf: null }); // no se marca como duplicada

    // Reprocesar el zip: ni se borra ni se duplica ninguna manual sin pareja.
    const again = await importZip();
    expect((again.stats as Record<string, number>).manualReplaced ?? 0).toBe(0);
    const manual = await db.select({ id: s.runs.id }).from(s.runs).where(eq(s.runs.source, "manual")).orderBy(asc(s.runs.startAt));
    expect(manual.map((m) => m.id).sort()).toEqual([alone, near].sort());
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM runs WHERE start_at = ${new Date(REF_START)}`)).rows as { n: number }[];
    expect(n).toBe(1);
  });
});
