/**
 * Diagnóstico de rendimiento (requiere sesión, como el resto de /api): ejecuta en la función,
 * en su región de Vercel, las mismas cargas de datos de cada pantalla y devuelve SOLO números
 * (ms, nº de consultas, rondas en serie, ida y vuelta a Neon).
 * ?modo=antes mide como antes del cambio (cada pieza por su cuenta y comprobación de reglas
 * en cada consulta); sin modo, lo actual sin caché y con caché.
 */
import { NextResponse, connection } from "next/server";
import { sql } from "drizzle-orm";
import { db, queryTrace } from "@/lib/db/client";
import { summarizeTrace, type QuerySpan } from "@/lib/perf/trace";
import { setClassifyMemo } from "@/lib/analysis/session-type-db";
import { DEFAULT_HR_BAND } from "@/lib/analysis/pace-at-hr";
import * as q from "@/lib/db/queries";
import * as sc from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";

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

  // «antes»: cada pieza pide lo suyo (como antes del cambio). «actual»: lo común una vez y en
  // paralelo (sin caché), y la misma pantalla con caché (1.ª vez la llena, 2.ª la lee).
  const old: Record<string, () => Promise<unknown>> = {
    inicio: () => Promise.all([q.getHome(), q.getHomeOverview()]),
    actividad: () => q.listRuns(null),
    analisis: async () => {
      await q.getAnalysis(DEFAULT_HR_BAND);
      await Promise.all([q.getPeriodsView("week", 12), q.getFitness(), q.getInsights("6m", null), q.getEfficiency("rodaje")]);
    },
    detalle: () => (latest ? q.getRun(latest) : Promise.resolve(null)),
    perfil: () => Promise.all([q.getTrainingSettingsView(), q.getGoalsSettings(), q.getInjuriesView()]),
  };
  const fresh: Record<string, () => Promise<unknown>> = {
    inicio: () => {
      const c = q.makeCtx();
      return Promise.all([q.getHome(c), q.getHomeOverview(c)]);
    },
    actividad: () => q.listRuns(null),
    analisis: () => {
      const c = q.makeCtx();
      return Promise.all([q.getAnalysis(DEFAULT_HR_BAND, c), q.getPeriodsAll(c), q.getFitness(c), q.getInsights("all", null, c), q.getEfficiency("rodaje", c), q.getEfficiency(null, c)]);
    },
    detalle: () => (latest ? q.getRun(latest) : Promise.resolve(null)),
    perfil: () => {
      const c = q.makeCtx();
      return Promise.all([q.getTrainingSettingsView(c), q.getGoalsSettings(c), q.getInjuriesView(c)]);
    },
  };
  const day = cacheDay();
  const cached: Record<string, () => Promise<unknown>> = {
    inicio: () => sc.homeScreen(day),
    actividad: () => sc.activityScreen(day),
    analisis: () => sc.analysisScreen(day),
    detalle: () => (latest ? sc.runScreen(latest, day) : Promise.resolve(null)),
    perfil: () => sc.profileScreen(day),
  };
  setClassifyMemo(!before);
  const out: Record<string, unknown> = {};
  try {
    for (const name of Object.keys(old)) {
      out[name] = before
        ? [await measure(old[name]), await measure(old[name])]
        : { sinCache: [await measure(fresh[name]), await measure(fresh[name])], conCache: [await measure(cached[name]), await measure(cached[name])] };
    }
  } finally {
    setClassifyMemo(true);
  }
  return NextResponse.json({ region: process.env.VERCEL_REGION ?? "local", modo: before ? "antes" : "actual", rttMs: rtt, screens: out }, { headers: { "cache-control": "no-store" } });
}
