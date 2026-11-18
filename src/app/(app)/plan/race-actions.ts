"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { dataChanged } from "@/lib/cache/invalidate";
import { cacheDay } from "@/lib/cache/tags";
import { parseGpx } from "@/lib/import/gpx";
import { parseRaceForm, raceProfile, type RaceErrors, type RaceProfile } from "@/lib/race/race";
import { deleteRace, saveRace } from "@/lib/race/race-db";

export type RaceState = { errors?: RaceErrors; error?: string };
const UUID = /^[0-9a-f-]{36}$/i;

/** Crea o edita una carrera objetivo (con GPX opcional para el perfil de altitud). */
export async function saveRaceAction(_prev: RaceState, fd: FormData): Promise<RaceState> {
  const f: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") f[k] = v;
  const { input, errors } = parseRaceForm(f, cacheDay());
  const id = (f.id ?? "").trim() || null;
  if (id && !UUID.test(id)) return { error: "Carrera no válida." };
  if (!input) return { errors };

  let profile: RaceProfile | null | undefined;
  const file = fd.get("gpx");
  if (file instanceof File && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) return { errors: { gpx: "El GPX pasa de 4 MB." } };
    try {
      profile = raceProfile(parseGpx(await file.text()), input.distanceM);
    } catch {
      profile = null;
    }
    if (!profile) return { errors: { gpx: "El GPX no tiene puntos con altitud: no se puede sacar el perfil." } };
  } else if (f.removeGpx === "on") profile = null;

  const saved = await saveRace(db(), input, { id, profile });
  dataChanged();
  refresh();
  redirect(`/plan/carrera/${saved}?aviso=${id ? "carrera-objetivo-actualizada" : "carrera-objetivo-creada"}`);
}

export async function deleteRaceAction(id: string): Promise<{ ok: boolean }> {
  if (!UUID.test(id)) return { ok: false };
  await deleteRace(db(), id);
  dataChanged();
  refresh();
  redirect("/plan?aviso=carrera-objetivo-borrada");
}

/** Estrategia de ritmos elegida (se guarda en segundo plano al cambiarla). */
export async function setRaceStrategyAction(id: string, strategy: string): Promise<{ ok: boolean }> {
  const { isStrategy } = await import("@/lib/race/pacing");
  if (!UUID.test(id) || !isStrategy(strategy)) return { ok: false };
  const { eq } = await import("drizzle-orm");
  const s = await import("@/lib/db/schema");
  await db().update(s.raceGoals).set({ strategy, updatedAt: new Date() }).where(eq(s.raceGoals.id, id));
  dataChanged();
  return { ok: true };
}
