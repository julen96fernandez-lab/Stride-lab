import "server-only";
/**
 * Una función con caché por pantalla. Dentro, todo lo independiente va en paralelo y lo común
 * se pide una vez (makeCtx). La caché es compartida entre instancias ('use cache: remote') y
 * se invalida con la etiqueta DATA_TAG en cada cambio de datos (ver cache/invalidate.ts).
 * El día va en la clave: al cambiar de día se recalcula.
 */
import { cacheLife, cacheTag } from "next/cache";
import { DATA_LIFE, DATA_TAG } from "@/lib/cache/tags";
import { DEFAULT_HR_BAND } from "@/lib/analysis/pace-at-hr";
import * as q from "./queries";

export async function homeScreen(day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  const ctx = q.makeCtx();
  const [home, overview, nextRace, mineToday] = await Promise.all([q.getHome(ctx), q.getHomeOverview(ctx), q.getNextRace(day, ctx), q.getMineOn(day)]);
  return { home, overview, nextRace, mineToday };
}

export async function activityScreen(day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  void day;
  return q.listRuns(null);
}

export async function analysisScreen(day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  const ctx = q.makeCtx();
  const [analysis, periods, fitness, insights, effRodaje, effAll, feelings] = await Promise.all([
    q.getAnalysis(DEFAULT_HR_BAND, ctx),
    q.getPeriodsAll(ctx),
    q.getFitness(ctx),
    q.getInsights("all", null, ctx),
    q.getEfficiency("rodaje", ctx),
    q.getEfficiency(null, ctx),
    q.getFeelingStats(day),
  ]);
  return { analysis, periods, fitness, insights, effRodaje, effAll, feelings };
}

export async function runScreen(id: string, day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  void day;
  return q.getRun(id);
}

export async function profileScreen(day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  void day;
  const ctx = q.makeCtx();
  const [settings, goals, injuries, shiftAnchor] = await Promise.all([
    q.getTrainingSettingsView(ctx),
    q.getGoalsSettings(ctx),
    q.getInjuriesView(ctx),
    ctx.shiftAnchor(),
  ]);
  return { settings, goals, injuries, shiftAnchor };
}

export async function recordsScreen(day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  void day;
  return q.getRecords();
}

export async function planScreen(day: string) {
  "use cache: remote";
  cacheTag(DATA_TAG);
  cacheLife(DATA_LIFE);
  return q.getPlan(day);
}
