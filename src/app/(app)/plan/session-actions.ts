"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { cacheDay } from "@/lib/cache/tags";
import { getPlan } from "@/lib/db/queries";
import { parseMineForm, type MineErrors } from "@/lib/plan/mine";
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
