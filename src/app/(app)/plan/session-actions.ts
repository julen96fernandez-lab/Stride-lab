"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { cacheDay } from "@/lib/cache/tags";
import { getPlan } from "@/lib/db/queries";
import { mineDateError, mineKindOf, parseMineForm, type MineErrors } from "@/lib/plan/mine";
import { SESSION_LABEL, fmtDay, type SessionKind } from "@/lib/plan/weekly";
import { dayNum, mondayOfDay } from "@/lib/plan/shifts";
import { deleteMine, dismissWeek, restoreWeek, saveMine } from "@/lib/plan/plan-db";

export type MineState = { errors?: MineErrors; error?: string };
const UUID = /^[0-9a-f-]{36}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const back = (v: string | undefined) => (v === "inicio" ? "/" : "/plan");

/** Crea o edita una sesión mía (también al editar o mover la sugerida). */
export async function saveMineAction(_prev: MineState, fd: FormData): Promise<MineState> {
  const f: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") f[k] = v;
  const id = (f.id ?? "").trim() || null;
  if (id && !UUID.test(id)) return { error: "Sesión no válida." };
  const { input, errors } = parseMineForm(f, cacheDay());
  if (!input) return { errors };
  const saved = await saveMine(db(), input, id);
  dataChanged();
  refresh();
  // Si choca con alguna regla, se guarda igual y se avisa.
  const warned = (await getPlan(cacheDay())).mine.find((m) => m.id === saved)?.warnings.length;
  redirect(`${back(f.volver)}?aviso=${warned ? "sesion-con-aviso" : id ? "sesion-actualizada" : "sesion-guardada"}`);
}

export async function deleteMineAction(id: string): Promise<{ ok: boolean }> {
  if (!UUID.test(id)) return { ok: false };
  await deleteMine(db(), id);
  dataChanged();
  refresh();
  redirect("/plan?aviso=sesion-borrada");
}

/** Quitar la sugerencia de una semana. */
export async function dismissSuggestionAction(weekStart: string): Promise<{ ok: boolean }> {
  if (!YMD.test(weekStart)) return { ok: false };
  const plan = await getPlan(cacheDay());
  const w = plan.sessions.find((x) => x.start === weekStart);
  if (!w) return { ok: false };
  await dismissWeek(db(), w);
  dataChanged();
  refresh();
  redirect("/plan?aviso=sugerencia-quitada");
}

export async function restoreSuggestionAction(weekStart: string): Promise<{ ok: boolean; message: string }> {
  if (!YMD.test(weekStart)) return { ok: false, message: "Semana no válida." };
  const plan = await getPlan(cacheDay());
  const current = plan.sessions[0]?.start ?? weekStart;
  await restoreWeek(db(), weekStart, current);
  dataChanged();
  refresh();
  return { ok: true, message: "Sugerencia recuperada." };
}

type Result = { ok: boolean; message: string };

/** Mensaje tras mover: con aviso si choca con alguna regla (se mueve igual). */
async function movedMessage(id: string, date: string): Promise<Result> {
  const warned = (await getPlan(cacheDay())).mine.find((m) => m.id === id)?.warnings ?? [];
  return { ok: true, message: warned.length ? `Movida al ${fmtDay(date)}, con aviso: ${warned[0]}` : `Movida al ${fmtDay(date)}.` };
}

/** «Mover a…» una sesión mía: solo cambia la fecha. */
export async function moveMineAction(id: string, date: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, message: "Sesión no válida." };
  const err = mineDateError(date, cacheDay());
  if (err) return { ok: false, message: err };
  const { eq } = await import("drizzle-orm");
  const s = await import("@/lib/db/schema");
  const rows = await db().update(s.plannedSessions).set({ date, updatedAt: new Date() }).where(eq(s.plannedSessions.id, id)).returning({ id: s.plannedSessions.id });
  if (!rows.length) return { ok: false, message: "Esa sesión ya no existe." };
  dataChanged();
  refresh();
  return movedMessage(id, date);
}

/** «Mover a…» la sugerida: pasa a ser mía en la nueva fecha y sustituye a la de su semana. */
export async function moveSuggestionAction(weekStart: string, session: string, date: string): Promise<Result> {
  const w = YMD.test(weekStart) ? dayNum(weekStart) : null;
  if (w === null || mondayOfDay(w) !== w || !(session in SESSION_LABEL)) return { ok: false, message: "Sugerencia no válida." };
  const err = mineDateError(date, cacheDay());
  if (err) return { ok: false, message: err };
  const id = await saveMine(db(), { date, kind: mineKindOf(session as SessionKind), distanceM: null, durationS: null, note: null, replacesWeek: weekStart });
  dataChanged();
  refresh();
  return movedMessage(id, date);
}

/** Avisos de una sesión mía recién guardada (se guarda igual). */
async function warningsOf(id: string): Promise<string[]> {
  return (await getPlan(cacheDay())).mine.find((m) => m.id === id)?.warnings ?? [];
}

/**
 * Hoja del día: poner el entrenamiento con un toque. Si ya hay una sesión mía ese día (`id`), le
 * cambia el tipo; si no, la crea. Si choca con una regla, se guarda igual y se devuelve el aviso.
 */
export async function setDayKindAction(date: string, kind: string, id?: string | null): Promise<Result & { id?: string; warnings?: string[] }> {
  const { isMineKind, MINE_LABEL } = await import("@/lib/plan/mine");
  if (!isMineKind(kind)) return { ok: false, message: "Tipo no válido." };
  if (id && !UUID.test(id)) return { ok: false, message: "Sesión no válida." };
  const err = mineDateError(date, cacheDay());
  if (err) return { ok: false, message: err };
  let saved = id ?? null;
  if (id) {
    const { eq } = await import("drizzle-orm");
    const s = await import("@/lib/db/schema");
    const rest = kind === "descanso" ? { distanceM: null, durationS: null } : {};
    const rows = await db().update(s.plannedSessions).set({ kind, ...rest, updatedAt: new Date() }).where(eq(s.plannedSessions.id, id)).returning({ id: s.plannedSessions.id });
    if (!rows.length) saved = null;
  }
  if (!saved) saved = await saveMine(db(), { date, kind, distanceM: null, durationS: null, note: null, replacesWeek: null });
  dataChanged();
  refresh();
  const warnings = await warningsOf(saved);
  const what = kind === "descanso" ? "Día de descanso" : MINE_LABEL[kind];
  return { ok: true, id: saved, warnings, message: warnings.length ? `${what} guardado, con aviso: ${warnings[0]}` : `${what} · puesta por ti.` };
}

/** Hoja del día: km, duración y nota de mi sesión (opcionales). */
export async function setDayDetailsAction(id: string, f: { distanceKm: string; duration: string; note: string }): Promise<Result & { errors?: MineErrors }> {
  if (!UUID.test(id)) return { ok: false, message: "Sesión no válida." };
  const { getMine } = await import("@/lib/plan/plan-db");
  const m = await getMine(db(), id);
  if (!m) return { ok: false, message: "Esa sesión ya no existe." };
  // Se valida igual que el formulario (la fecha puede ser de hace más de 4 semanas: no se toca).
  const { input, errors } = parseMineForm({ date: cacheDay(), kind: m.kind, distanceKm: f.distanceKm, duration: f.duration, note: f.note }, cacheDay());
  if (!input) return { ok: false, message: Object.values(errors)[0] ?? "Revisa los datos.", errors };
  const { eq } = await import("drizzle-orm");
  const s = await import("@/lib/db/schema");
  await db().update(s.plannedSessions).set({ distanceM: input.distanceM, durationS: input.durationS, note: input.note, updatedAt: new Date() }).where(eq(s.plannedSessions.id, id));
  dataChanged();
  refresh();
  return { ok: true, message: "Guardado." };
}

/** Hoja del día: «Quitar» mi sesión (sin salir del calendario). */
export async function removeMineAction(id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, message: "Sesión no válida." };
  await deleteMine(db(), id);
  dataChanged();
  refresh();
  return { ok: true, message: "Sesión quitada." };
}
