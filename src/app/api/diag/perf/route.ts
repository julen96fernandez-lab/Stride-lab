/**
 * Diagnóstico de rendimiento (requiere sesión, como el resto de /api): ejecuta en la función,
 * en su región de Vercel, las mismas cargas de datos de cada pantalla y devuelve SOLO números
 * (ms, nº de consultas, rondas en serie, ida y vuelta a Neon).
 * ?modo=antes mide sin la memoria de la comprobación de reglas (como antes del arreglo).
 */
import { NextResponse, connection } from "next/server";
import { sql } from "drizzle-orm";
import { db, queryTrace } from "@/lib/db/client";
import { summarizeTrace, type QuerySpan } from "@/lib/perf/trace";
import { setClassifyMemo } from "@/lib/analysis/session-type-db";
import { DEFAULT_HR_BAND } from "@/lib/analysis/pace-at-hr";
import * as q from "@/lib/db/queries";

async function measure(fn: () => Promise<unknown>) {
  const spans: QuerySpan[] = [];
  const t0 = performance.now();
  await queryTrace.run(spans, fn);
  return { ms: Math.round(performance.now() - t0), ...summarizeTrace(spans) };
}

export async function GET(req: Request) {
  await connection();
  const before = new URL(req.url).searchParams.get("modo") === "antes";
  const d = db();
  const latest = (await d.execute<{ id: string }>(sql`SELECT id FROM runs WHERE status = 'valid' ORDER BY start_at DESC LIMIT 1`)).rows[0]?.id;

  const rtt: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await d.execute(sql`SELECT 1`);
    rtt.push(Math.round(performance.now() - t));
  }

  const screens: Record<string, () => Promise<unknown>> = {
    inicio: () => Promise.all([q.getHome(), q.getHomeOverview()]),
    actividad: () => q.listRuns(null),
    analisis: async () => {
      await q.getAnalysis(DEFAULT_HR_BAND);
      await Promise.all([q.getPeriodsView("week", 12), q.getFitness(), q.getInsights("6m", null), q.getEfficiency("rodaje")]);
    },
    detalle: () => (latest ? q.getRun(latest) : Promise.resolve(null)),
    perfil: () => Promise.all([q.getTrainingSettingsView(), q.getGoalsSettings(), q.getInjuriesView()]),
    records: () => q.getRecords(),
  };
  setClassifyMemo(!before);
  const out: Record<string, unknown[]> = {};
  try {
    for (const [name, fn] of Object.entries(screens)) out[name] = [await measure(fn), await measure(fn)];
  } finally {
    setClassifyMemo(true);
  }
  return NextResponse.json({ region: process.env.VERCEL_REGION ?? "local", modo: before ? "antes" : "actual", rttMs: rtt, screens: out }, { headers: { "cache-control": "no-store" } });
}
