import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { shoeKm, shoeUsage, type ShoeInput, type ShoeUsage } from "./shoes";

export interface ShoeView {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  purchasedAt: string | null;
  retiredAt: string | null;
  initialKm: number;
  limitKm: number;
  isDefault: boolean;
  countTreadmill: boolean;
  km: number;
  /** carreras que suman */
  runs: number;
  /** carreras asignadas (sumen o no) */
  assigned: number;
  usage: ShoeUsage;
}

/** Zapatillas con sus km (activas primero; la habitual arriba). */
export async function listShoes(db: Db): Promise<ShoeView[]> {
  const [shoes, links] = await Promise.all([
    db.select().from(s.shoes).orderBy(asc(s.shoes.createdAt)),
    db
      .select({ shoeId: s.runShoes.shoeId, distanceM: s.runs.distanceM, status: s.runs.status, isIndoor: s.runs.isIndoor })
      .from(s.runShoes)
      .innerJoin(s.runs, eq(s.runs.id, s.runShoes.runId)),
  ]);
  return shoes
    .map((sh) => {
      const mine = links.filter((l) => l.shoeId === sh.id);
      const { km, runs } = shoeKm(sh, mine);
      return {
        id: sh.id,
        name: sh.name,
        brand: sh.brand,
        model: sh.model,
        purchasedAt: sh.purchasedAt,
        retiredAt: sh.retiredAt,
        initialKm: sh.initialKm,
        limitKm: sh.limitKm,
        isDefault: sh.isDefault,
        countTreadmill: sh.countTreadmill,
        km,
        runs,
        assigned: mine.length,
        usage: shoeUsage(km, sh.limitKm),
      };
    })
    .sort((a, b) => Number(!!a.retiredAt) - Number(!!b.retiredAt) || Number(b.isDefault) - Number(a.isDefault));
}

/** Crea o edita. Si es la habitual, deja de serlo cualquier otra. */
export async function saveShoe(db: Db, input: ShoeInput, id?: string | null): Promise<string | null> {
  return db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(s.shoes).set({ isDefault: false }).where(eq(s.shoes.isDefault, true));
    const values = { ...input, updatedAt: new Date() };
    if (id) {
      const cur = (await tx.select({ retiredAt: s.shoes.retiredAt }).from(s.shoes).where(eq(s.shoes.id, id)))[0];
      if (!cur) return null;
      // Una retirada no puede ser la habitual.
      await tx.update(s.shoes).set({ ...values, isDefault: input.isDefault && !cur.retiredAt }).where(eq(s.shoes.id, id));
      return id;
    }
    const [row] = await tx.insert(s.shoes).values(values).returning({ id: s.shoes.id });
    return row.id;
  });
}

/** Retirar (con fecha) o volver a activar. Al retirarla deja de ser la habitual. */
export async function setRetired(db: Db, id: string, retiredAt: string | null): Promise<boolean> {
  const set = retiredAt ? { retiredAt, isDefault: false, updatedAt: new Date() } : { retiredAt: null, updatedAt: new Date() };
  const r = await db.update(s.shoes).set(set).where(eq(s.shoes.id, id)).returning({ id: s.shoes.id });
  return r.length > 0;
}

/** Borra la zapatilla (sus asignaciones se van con ella; las carreras quedan). */
export async function deleteShoe(db: Db, id: string): Promise<boolean> {
  const r = await db.delete(s.shoes).where(eq(s.shoes.id, id)).returning({ id: s.shoes.id });
  return r.length > 0;
}

/** La habitual (activa), para preseleccionarla en el formulario manual. */
export async function defaultShoeId(db: Db): Promise<string | null> {
  const r = await db.select({ id: s.shoes.id }).from(s.shoes).where(and(eq(s.shoes.isDefault, true), isNull(s.shoes.retiredAt))).limit(1);
  return r[0]?.id ?? null;
}

export async function getRunShoe(db: Db, runId: string): Promise<string | null> {
  const r = await db.select({ shoeId: s.runShoes.shoeId }).from(s.runShoes).where(eq(s.runShoes.runId, runId)).limit(1);
  return r[0]?.shoeId ?? null;
}

/** Asigna (o quita, con null) la zapatilla de una carrera. */
export async function assignShoe(db: Db, runId: string, shoeId: string | null): Promise<void> {
  if (!shoeId) {
    await db.delete(s.runShoes).where(eq(s.runShoes.runId, runId));
    return;
  }
  await db
    .insert(s.runShoes)
    .values({ runId, shoeId })
    .onConflictDoUpdate({ target: s.runShoes.runId, set: { shoeId, createdAt: new Date() } });
}

/**
 * «Asignar a todas las carreras entre dos fechas» (días de Madrid, incluidos): solo las válidas;
 * por defecto solo las que no tienen zapatilla («también las que ya tienen otra» las cambia). Si
 * la zapatilla no cuenta la cinta, las de cinta se dejan como están.
 */
export async function bulkAssign(db: Db, shoeId: string, from: string, to: string, overwrite: boolean): Promise<number | null> {
  const shoe = (await db.select().from(s.shoes).where(eq(s.shoes.id, shoeId)))[0];
  if (!shoe) return null;
  const day = sql`(${s.runs.startAt} AT TIME ZONE 'Europe/Madrid')::date`;
  const rows = await db
    .select({ id: s.runs.id, isIndoor: s.runs.isIndoor, current: s.runShoes.shoeId })
    .from(s.runs)
    .leftJoin(s.runShoes, eq(s.runShoes.runId, s.runs.id))
    .where(and(eq(s.runs.status, "valid"), sql`${day} >= ${from}::date`, sql`${day} <= ${to}::date`));
  const ids = rows
    .filter((r) => (overwrite ? r.current !== shoeId : !r.current))
    .filter((r) => shoe.countTreadmill || r.isIndoor !== true)
    .map((r) => r.id);
  if (!ids.length) return 0;
  await db
    .insert(s.runShoes)
    .values(ids.map((runId) => ({ runId, shoeId })))
    .onConflictDoUpdate({ target: s.runShoes.runId, set: { shoeId, createdAt: new Date() } });
  return ids.length;
}

/** Al sustituir una manual por la del zip: su zapatilla pasa a la del zip (si no tenía ya una). */
export async function moveShoe(db: Db, fromRunId: string, toRunId: string): Promise<void> {
  const [from, to] = await Promise.all([getRunShoe(db, fromRunId), getRunShoe(db, toRunId)]);
  if (from && !to) await db.update(s.runShoes).set({ runId: toRunId }).where(eq(s.runShoes.runId, fromRunId));
}

/** Zapatilla de cada carrera (para listas y filtros). */
export async function shoesOfRuns(db: Db, runIds: readonly string[]): Promise<Map<string, string>> {
  if (!runIds.length) return new Map();
  const r = await db.select().from(s.runShoes).where(inArray(s.runShoes.runId, [...runIds]));
  return new Map(r.map((x) => [x.runId, x.shoeId]));
}
