import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { paceInHrBand, z2Band } from "./efficiency";
import type { HrZones } from "./hr-zones";
import { buildStream } from "./run-stream";

/** Ritmo en Z2 de cada carrera válida (con muestras de distancia y pulso). */
export async function recomputeEfficiency(db: Db, zones: HrZones): Promise<number> {
  const rows = await db
    .select({ runId: s.runSeries.runId, metric: s.runSeries.metric, t: s.runSeries.t, v: s.runSeries.v, durationS: s.runs.durationS })
    .from(s.runSeries)
    .innerJoin(s.runs, and(eq(s.runs.id, s.runSeries.runId), eq(s.runs.status, "valid")))
    .where(inArray(s.runSeries.metric, ["distance", "hr"]));
  const byRun = new Map<string, { durationS: number; distance?: { t: number[]; v: number[] }; hr?: { t: number[]; v: number[] } }>();
  for (const r of rows) {
    const e = byRun.get(r.runId) ?? { durationS: r.durationS };
    e[r.metric as "distance" | "hr"] = { t: r.t, v: r.v };
    byRun.set(r.runId, e);
  }
  const band = z2Band(zones.limits);
  let n = 0;
  await db.update(s.runs).set({ efZ2PaceSPerKm: null, efZ2Seconds: null }).where(eq(s.runs.status, "valid"));
  for (const [runId, e] of byRun) {
    if (!e.distance || !e.hr) continue;
    const st = buildStream({ durationS: e.durationS, distance: e.distance, hr: e.hr });
    const step = st.t.length > 1 ? st.t[1] - st.t[0] : 3;
    const r = paceInHrBand(st.pace, st.hr, step, band);
    if (!r) continue;
    await db.update(s.runs).set({ efZ2PaceSPerKm: r.paceSPerKm, efZ2Seconds: r.seconds }).where(eq(s.runs.id, runId));
    n++;
  }
  return n;
}
