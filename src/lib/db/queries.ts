import "server-only";
import { EFFORT_DISTANCES, improvementPct, recordProgression, type EffortKey } from "@/lib/analysis/best-efforts";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema as s } from "./client";
import { decodePolyline } from "@/lib/import/gpx";
import { HR_BANDS, paceAtHrByYear, type YearPace } from "@/lib/analysis/pace-at-hr";
import { durabilityFromSeries, durabilityFromSplits, type Durability } from "@/lib/analysis/durability";
import type { SeriesMetric } from "./schema";
import { effectiveType, ensureClassified, getTypeSettings, getZones } from "@/lib/analysis/session-type-db";
import { SESSION_TYPES, isSessionType, type SessionType } from "@/lib/analysis/session-type";
import { buildStream, countStretches, gradeAlong, isHrSparse, markSplitEstimates, missingDistance, preferGpsKm, splitViews, trackCumulative, type PaceSource, type SplitView } from "@/lib/analysis/run-stream";
import { analyzeIntervals, type IntervalAnalysis, type StepTiming } from "@/lib/analysis/intervals";
import { decouplingEligible, z2Band, type DecouplingCheck } from "@/lib/analysis/efficiency";
import { ensureTrack } from "@/lib/analysis/track-db";
import { memoOnce } from "@/lib/cache/memo";
import { getFeeling } from "@/lib/feelings/feelings-db";
import { getShiftAnchor, listShiftOverrides } from "@/lib/plan/shifts-db";
import { listRaces } from "@/lib/race/race-db";

const TZ = "Europe/Madrid";
const valid = eq(s.runs.status, "valid");

/**
 * Contexto de una carga de pantalla: lo común (comprobación de reglas, carreras, objetivos,
 * lesiones, zonas) se pide UNA vez y lo comparten todas las piezas de la pantalla, en vez de
 * repetir la misma consulta en cada tarjeta.
 */
export function makeCtx() {
  const once = memoOnce();
  const classified = () => once("classified", () => ensureClassified(db()));
  return {
    classified,
    runs: () => once("runs", async () => (await classified(), runsForPeriods())),
    goals: () => once("goals", () => getGoals(db())),
    injuries: () => once("injuries", () => listInjuries(db())),
    zones: () => once("zones", () => getZones(db())),
    typeSettings: () => once("typeSettings", () => getTypeSettings(db())),
    shiftAnchor: () => once("shiftAnchor", () => getShiftAnchor(db())),
    /** días con el turno cambiado (todos: son pocos) */
    shiftOverrides: () => once("shiftOverrides", () => listShiftOverrides(db(), "1900-01-01", "2999-12-31")),
    races: () => once("races", () => listRaces(db())),
  };
}
export type Ctx = ReturnType<typeof makeCtx>;

// ─── Miniaturas de ruta (SVG en el servidor, sin enviar la polyline entera) ──

export interface RouteShape {
  /** Trazado SVG en un lienzo 100×100 (se conserva la proporción). */
  d: string;
  start: [number, number];
  end: [number, number];
}

export function routeShape(polyline: string | null, maxPoints = 60): RouteShape | null {
  if (!polyline) return null;
  const pts = decodePolyline(polyline);
  if (pts.length < 2) return null;
  const step = Math.max(1, Math.floor(pts.length / maxPoints));
  const sample = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const lat0 = (sample.reduce((a, p) => a + p[0], 0) / sample.length) * (Math.PI / 180);
  const xy = sample.map(([lat, lon]) => [lon * Math.cos(lat0), -lat] as const);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const offX = (span - (Math.max(...xs) - minX)) / 2;
  const offY = (span - (Math.max(...ys) - minY)) / 2;
  const P = (p: readonly [number, number]) =>
    [8 + ((p[0] - minX + offX) / span) * 84, 8 + ((p[1] - minY + offY) / span) * 84] as [number, number];
  const mapped = xy.map(P);
  return {
    d: mapped.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "),
    start: mapped[0],
    end: mapped[mapped.length - 1],
  };
}

// ─── Inicio ──────────────────────────────────────────────────────────────────

export interface RunListItem {
  id: string;
  startAt: Date;
  distanceM: number | null;
  durationS: number;
  avgPaceSPerKm: number | null;
  avgHr: number | null;
  isSpecial: boolean;
  isIndoor: boolean | null;
  source: string;
  route: RouteShape | null;
  type: SessionType | null;
  typeManual: boolean;
  trainingLoad: number | null;
  loadEstimated: boolean;
  /** sensación: valoración (si la hay) y si hay alguna (valoración, nota o etiquetas) */
  feelRating: number | null;
  hasFeeling: boolean;
}

function listColumns() {
  return {
    id: s.runs.id,
    startAt: s.runs.startAt,
    distanceM: s.runs.distanceM,
    durationS: s.runs.durationS,
    avgPaceSPerKm: s.runs.avgPaceSPerKm,
    avgHr: s.runs.avgHr,
    isSpecial: s.runs.isSpecial,
    isIndoor: s.runs.isIndoor,
    source: s.runs.source,
    polyline: s.runRoutes.polyline,
    type: effectiveType,
    typeManual: sql<boolean>`${s.runs.sessionTypeManual} IS NOT NULL`,
    trainingLoad: s.runs.trainingLoad,
    loadEstimated: s.runs.loadEstimated,
    feelRating: s.runFeelings.rating,
    hasFeeling: sql<boolean>`${s.runFeelings.runId} IS NOT NULL`,
  };
}

function toItem(r: { polyline: string | null; type: string | null } & Omit<RunListItem, "route" | "type">, maxPts = 40): RunListItem {
  const { polyline, type, ...rest } = r;
  return { ...rest, type: isSessionType(type) ? type : null, route: routeShape(polyline, maxPts) };
}

export interface KmByType {
  type: SessionType;
  km: number;
  runs: number;
}

/** Km y nº de carreras por tipo efectivo (todos los tipos, también los que suman 0). */
async function kmByType(where: ReturnType<typeof sql>): Promise<KmByType[]> {
  const res = await db().execute(sql`
    SELECT coalesce(session_type_manual, session_type_auto) AS t, sum(distance_m) / 1000 AS km, count(*)::int AS n
    FROM runs WHERE status = 'valid' AND ${where} GROUP BY 1`);
  const m = new Map((res.rows as { t: string | null; km: string | null; n: number }[]).map((r) => [r.t, r]));
  return SESSION_TYPES.map((t) => ({ type: t, km: Number(m.get(t)?.km ?? 0), runs: m.get(t)?.n ?? 0 }));
}

export async function getHome(ctx: Ctx = makeCtx()) {
  const d = db();
  await ctx.classified();
  const [last28Rows, monthsRows, vo2Rows, lastRuns, totals, byType] = await Promise.all([
    d.execute(sql`
      SELECT count(*)::int AS runs,
             sum(distance_m) AS dist,
             sum(duration_s) AS dur,
             sum(duration_s) FILTER (WHERE NOT is_special AND NOT in_injury AND distance_m > 0) AS dur_ns,
             sum(distance_m) FILTER (WHERE NOT is_special AND NOT in_injury AND distance_m > 0) AS dist_ns,
             sum(avg_hr * duration_s) FILTER (WHERE avg_hr IS NOT NULL) / nullif(sum(duration_s) FILTER (WHERE avg_hr IS NOT NULL), 0) AS hr
      FROM runs WHERE status = 'valid' AND start_at >= now() - interval '28 days'`),
    d.execute(sql`
      WITH m AS (
        SELECT generate_series(date_trunc('month', (now() AT TIME ZONE ${TZ})) - interval '11 months',
                               date_trunc('month', (now() AT TIME ZONE ${TZ})), interval '1 month') AS month
      )
      SELECT to_char(m.month, 'YYYY-MM') AS month,
             coalesce(sum(r.distance_m), 0) / 1000 AS km,
             count(r.id)::int AS runs
      FROM m LEFT JOIN runs r ON r.status = 'valid'
        AND date_trunc('month', r.start_at AT TIME ZONE ${TZ}) = m.month
      GROUP BY m.month ORDER BY m.month`),
    d.execute(sql`
      SELECT to_char((measured_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, avg(value) AS v
      FROM vo2max_readings WHERE measured_at >= now() - interval '14 months'
      GROUP BY 1 ORDER BY 1`),
    d
      .select(listColumns())
      .from(s.runs)
      .leftJoin(s.runRoutes, eq(s.runRoutes.runId, s.runs.id))
      .leftJoin(s.runFeelings, eq(s.runFeelings.runId, s.runs.id))
      .where(valid)
      .orderBy(desc(s.runs.startAt))
      .limit(1),
    d.execute(sql`SELECT count(*)::int AS n FROM runs WHERE status = 'valid'`),
    kmByType(sql`start_at >= date_trunc('month', now() AT TIME ZONE ${TZ}) - interval '11 months'`),
  ]);

  const l = last28Rows.rows[0] as Record<string, string | number | null>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const last28 = {
    runs: Number(l.runs),
    distanceM: num(l.dist),
    durationS: num(l.dur),
    paceSPerKm: num(l.dist_ns) && num(l.dur_ns) ? num(l.dur_ns)! / (num(l.dist_ns)! / 1000) : null,
    avgHr: num(l.hr),
  };
  const months = (monthsRows.rows as { month: string; km: string; runs: number }[]).map((m) => ({
    month: m.month,
    km: Number(m.km),
    runs: m.runs,
  }));
  const vo2 = (vo2Rows.rows as { day: string; v: string }[]).map((r) => ({ day: r.day, value: Number(r.v) }));
  const lr = lastRuns[0];
  const lastRun: RunListItem | null = lr ? toItem(lr, 60) : null;
  return { last28, months, vo2, lastRun, byType, totalRuns: (totals.rows[0] as { n: number }).n };
}

// ─── Actividad ───────────────────────────────────────────────────────────────

export async function listRuns(filter: SessionType | null, ctx: Ctx = makeCtx()) {
  const d = db();
  await ctx.classified();
  const [rows, hidden, counts] = await Promise.all([
    d
      .select(listColumns())
      .from(s.runs)
      .leftJoin(s.runRoutes, eq(s.runRoutes.runId, s.runs.id))
      .leftJoin(s.runFeelings, eq(s.runFeelings.runId, s.runs.id))
      .where(filter ? and(valid, sql`${effectiveType} = ${filter}`) : valid)
      .orderBy(desc(s.runs.startAt)),
    d.execute(sql`SELECT status, count(*)::int AS n FROM runs WHERE status <> 'valid' GROUP BY status`),
    kmByType(sql`true`),
  ]);
  const items: RunListItem[] = rows.map((r) => toItem(r));
  const h = Object.fromEntries((hidden.rows as { status: string; n: number }[]).map((x) => [x.status, x.n]));
  return { items, counts, hiddenDuplicates: h.duplicate ?? 0, hiddenInvalid: h.invalid ?? 0 };
}

// ─── Detalle ─────────────────────────────────────────────────────────────────

import { hrReliable, pickSimilar, runSummary } from "@/lib/analysis/summary";
import { ROUTE_RULES, sameRoute } from "@/lib/analysis/route-match";
import { compareSimilar } from "@/lib/analysis/similar";

export interface SameRouteRow {
  id: string;
  startAt: Date;
  durationS: number;
  distanceM: number | null;
  paceS: number | null;
  avgHr: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  current: boolean;
}

/**
 * Carreras anteriores por la misma ruta (mismo sentido). Primero se filtran en la base de datos
 * por recuadro y distancia (±5 %); solo de esas se cargan los trazados para compararlos.
 * null si hay menos de 2 coincidencias.
 */
async function getSameRoute(
  run: typeof s.runs.$inferSelect,
  route: typeof s.runRoutes.$inferSelect | null,
): Promise<SameRouteRow[] | null> {
  if (!route?.polyline || !run.distanceM || route.minLat === null || route.minLon === null || route.maxLat === null || route.maxLon === null) return null;
  const B = ROUTE_RULES.bboxDeg;
  const near = (col: AnyPgColumn, v: number) => and(gte(col, v - B), lte(col, v + B));
  const cands = await db()
    .select({
      id: s.runs.id,
      startAt: s.runs.startAt,
      durationS: s.runs.durationS,
      distanceM: s.runs.distanceM,
      paceS: s.runs.avgPaceSPerKm,
      avgHr: s.runs.avgHr,
      temperatureC: s.runs.temperatureC,
      humidityPct: s.runs.humidityPct,
      polyline: s.runRoutes.polyline,
    })
    .from(s.runs)
    .innerJoin(s.runRoutes, eq(s.runRoutes.runId, s.runs.id))
    .where(
      and(
        eq(s.runs.status, "valid"),
        sql`${s.runs.id} <> ${run.id}`,
        lt(s.runs.startAt, run.startAt),
        gte(s.runs.distanceM, run.distanceM * (1 - ROUTE_RULES.distPct)),
        lte(s.runs.distanceM, run.distanceM * (1 + ROUTE_RULES.distPct)),
        near(s.runRoutes.minLat, route.minLat),
        near(s.runRoutes.minLon, route.minLon),
        near(s.runRoutes.maxLat, route.maxLat),
        near(s.runRoutes.maxLon, route.maxLon),
      ),
    );
  const me = { distanceM: run.distanceM, pts: decodePolyline(route.polyline) };
  const matches = cands.filter((c) => c.polyline && sameRoute(me, { distanceM: c.distanceM, pts: decodePolyline(c.polyline) }));
  if (matches.length < ROUTE_RULES.minMatches) return null;
  return [
    { id: run.id, startAt: run.startAt, durationS: run.durationS, distanceM: run.distanceM, paceS: run.avgPaceSPerKm, avgHr: run.avgHr, temperatureC: run.temperatureC, humidityPct: run.humidityPct, current: true },
    ...matches.map(({ polyline: _p, ...m }) => (void _p, { ...m, current: false })),
  ].sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
}

export async function getRun(id: string, ctx: Ctx = makeCtx()) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const d = db();
  await ctx.classified();
  // Todo en una sola ronda: la carrera, su ruta, parciales, series, pista, vecinas y zonas.
  const [runRows, routeRows, splits, seriesRows, trackRows, neighbours, zones, feeling] = await Promise.all([
    d.select().from(s.runs).where(eq(s.runs.id, id)).limit(1),
    d.select().from(s.runRoutes).where(eq(s.runRoutes.runId, id)).limit(1),
    d.select().from(s.runSplits).where(eq(s.runSplits.runId, id)).orderBy(asc(s.runSplits.idx)),
    d.select().from(s.runSeries).where(eq(s.runSeries.runId, id)),
    d.select().from(s.runTracks).where(eq(s.runTracks.runId, id)).limit(1),
    d.execute(sql`
      SELECT
        (SELECT p.id FROM runs p, runs c WHERE c.id = ${id} AND p.status = 'valid' AND p.start_at < c.start_at ORDER BY p.start_at DESC LIMIT 1) AS prev,
        (SELECT n.id FROM runs n, runs c WHERE c.id = ${id} AND n.status = 'valid' AND n.start_at > c.start_at ORDER BY n.start_at ASC LIMIT 1) AS next`),
    ctx.zones(),
    getFeeling(d, id),
  ]);
  const run = runRows[0];
  if (!run) return null;
  const series = Object.fromEntries(seriesRows.map((r) => [r.metric, { t: r.t, v: r.v }])) as Partial<
    Record<SeriesMetric, { t: number[]; v: number[] }>
  >;
  let durability: Durability | null = null;
  if (series.distance) durability = durabilityFromSeries(series.distance, series.hr);
  if (!durability && splits.length) durability = durabilityFromSplits(splits, series.hr);
  const route = routeRows[0] ?? null;
  const nb = neighbours.rows[0] as { prev: string | null; next: string | null };
  const track = route ? await ensureTrack(d, run, route.blobUrl, trackRows[0] ?? null) : null;
  const type = run.sessionTypeManual ?? run.sessionTypeAuto;
  // Series: solo en carreras de tipo Series, con los pasos de intervalo y sus horas.
  const intervals: IntervalAnalysis | null =
    type === "series"
      ? analyzeIntervals((run.raw as { intervalEvents?: StepTiming[] } | null)?.intervalEvents ?? null, series.distance, series.hr)
      : null;
  const explorer = { ...buildExplorer({ run, series, track, splits, zones }), intervals };
  // Desacople aeróbico: solo en Rodaje / Tirada larga, con pulso y ritmo estable.
  const decoupling: DecouplingCheck = decouplingEligible({ type, hasHr: !!series.hr && series.hr.t.length > 1, splits });

  // Resumen con reglas: frente a las 5 últimas parecidas (mismo tipo, ±20 %, 12 meses).
  const sameRouteRows = await getSameRoute(run, route);
  const similar = pickSimilar({ id: run.id, type, startAt: run.startAt, distanceM: run.distanceM }, await ctx.runs());
  const summary = runSummary({
    run: {
      type,
      distanceM: run.distanceM,
      durationS: run.durationS,
      paceS: run.avgPaceSPerKm,
      avgHr: run.avgHr,
      zoneSeconds: run.hrZoneSeconds,
      load: run.trainingLoad,
      isIndoor: !!run.isIndoor,
      temperatureC: run.temperatureC,
      humidityPct: run.humidityPct,
    },
    halves: durability ? { paceDeltaS: durability.paceDeltaS, decouplingPct: durability.decouplingPct } : null,
    decouplingOk: decoupling.ok,
    similar: similar.map((x) => ({
      paceS: x.avgPaceSPerKm,
      avgHr: x.avgHr,
      hrReliable: hrReliable({ avgHr: x.avgHr, zoneSeconds: x.hrZoneSeconds, durationS: x.durationS }),
      load: x.trainingLoad,
    })),
  });
  return {
    run,
    summary,
    sameRoute: sameRouteRows,
    // Sesiones parecidas: solo si no hay tarjeta de misma ruta.
    similar: sameRouteRows
      ? null
      : compareSimilar(
          {
            id: run.id,
            startAt: run.startAt,
            paceS: run.isSpecial ? null : run.avgPaceSPerKm,
            avgHr: hrReliable({ avgHr: run.avgHr, zoneSeconds: run.hrZoneSeconds, durationS: run.durationS }) ? run.avgHr : null,
            load: run.trainingLoad,
            current: true,
          },
          similar.map((x) => ({
            id: x.id,
            startAt: x.startAt,
            paceS: x.avgPaceSPerKm,
            avgHr: hrReliable({ avgHr: x.avgHr, zoneSeconds: x.hrZoneSeconds, durationS: x.durationS }) ? x.avgHr : null,
            load: x.trainingLoad,
            current: false,
          })),
        ),
    similarLabel: type,
    route: route
      ? { points: decodePolyline(route.polyline ?? ""), bbox: [route.minLon, route.minLat, route.maxLon, route.maxLat] as const, shape: routeShape(route.polyline, 400) }
      : null,
    splits,
    hr: series.hr ?? null,
    power: series.power ?? null,
    durability,
    decoupling,
    zones,
    explorer,
    prevId: nb.prev,
    nextId: nb.next,
    feeling,
  };
}

/** Datos compactos para los gráficos sincronizados del detalle (ver run-stream.ts). */
export interface Explorer {
  t: number[];
  km: (number | null)[];
  pace: (number | null)[];
  gap: (number | null)[] | null;
  hr: (number | null)[] | null;
  ele: (number | null)[] | null;
  power: (number | null)[] | null;
  zone: (number | null)[] | null;
  /** posición en el mapa en cada instante (null sin pista) */
  lat: number[] | null;
  lon: number[] | null;
  coarsePace: boolean;
  avgPace: number | null;
  splits: SplitView[];
  zoneLimits: number[];
  /** origen del ritmo en cada instante (reloj, GPS, parcial, muestra cercana) */
  paceSource: (PaceSource | null)[];
  /** pausas reales (s): el ritmo se corta y se une con un punteado fino */
  pauses: [number, number][];
  /** tramos con ritmo estimado (para la nota bajo los gráficos) */
  estimatedStretches: { gps: number; split: number };
  /** Muestras de pulso tal cual (para dibujar con cortes y buscar la más cercana) */
  hrRaw: { t: number[]; v: number[] } | null;
  /** Pocas muestras de pulso: se dibuja por parciales */
  hrSparse: boolean;
  /** De dónde sale el eje de km y qué distancia no registró el reloj (para el aviso) */
  distanceInfo: { kmFrom: "samples" | "gps" | "none"; samplesM: number | null; gpsM: number | null; totalM: number | null; missing: { stretches: number; gpsM: number; watchM: number } | null };
  /** Pendiente (tanto por uno) en cada instante, para colorear la altitud */
  grade: (number | null)[] | null;
  /** Análisis de series (solo carreras de tipo Series); null en el resto */
  intervals?: IntervalAnalysis | null;
}

const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const r0 = (x: number | null) => (x === null ? null : Math.round(x));

function buildExplorer(a: {
  run: { durationS: number; avgPaceSPerKm: number | null; distanceM: number | null; raw?: unknown };
  series: Partial<Record<SeriesMetric, { t: number[]; v: number[] }>>;
  track: Awaited<ReturnType<typeof ensureTrack>>;
  splits: { idx: number; distanceM: number; durationS: number; paceSPerKm: number | null; avgHr: number | null; elevationGainM: number | null; elevationLossM: number | null; basis: string }[];
  zones: { limits: readonly number[] };
}): Explorer {
  const { run, series, track, splits, zones } = a;
  // Eje de km: la suma de muestras del reloj, salvo que se quede lejos del total y el GPS no.
  const samplesM = series.distance ? series.distance.v.reduce((a, b) => a + b, 0) : null;
  const gpsM = track && track.t.length > 1 ? (trackCumulative(track).at(-1) ?? null) : null;
  const kmFromGps = preferGpsKm(samplesM, gpsM, run.distanceM);
  const miss = missingDistance(series.distance, track);
  // Parciales (con su tramo de tiempo) antes del ritmo: sin GPS, rellenan los huecos.
  const startS = splits[0]?.basis === "gpx" ? (track?.t[0] ?? 0) : 0;
  // Primero se corrigen con GPS los que tienen tramos sin distancia; después, más rápido/lento y barras.
  const views = splitViews(markSplitEstimates(splitViews(splits, startS), miss, track), startS);
  const pauses = (run.raw as { pauses?: { startS: number; endS: number }[] } | null)?.pauses ?? null;
  const st = buildStream({
    pauses,
    splits: views,
    durationS: run.durationS,
    distance: series.distance,
    hr: series.hr,
    power: series.power,
    track,
    zones: zones as never,
    avgPace: run.avgPaceSPerKm,
    kmFromGps,
  });
  return {
    t: st.t.map((x) => Math.round(x)),
    km: st.km.map((k) => (k === null ? null : Math.round(k * 1000) / 1000)),
    pace: st.pace.map(r1),
    gap: st.gap?.map(r1) ?? null,
    hr: st.hr?.map(r0) ?? null,
    ele: st.ele?.map(r1) ?? null,
    power: st.power?.map(r0) ?? null,
    zone: st.zone,
    lat: track && st.trackIdx ? st.trackIdx.map((i) => track.lat[i]) : null,
    lon: track && st.trackIdx ? st.trackIdx.map((i) => track.lon[i]) : null,
    coarsePace: st.coarsePace,
    avgPace: st.avgPace,
    splits: views,
    paceSource: st.paceSource,
    pauses: st.pauses,
    estimatedStretches: { gps: countStretches(st.paceSource, "gps"), split: countStretches(st.paceSource, "split") + countStretches(st.paceSource, "near") },
    zoneLimits: [...zones.limits],
    hrRaw: series.hr && series.hr.t.length ? { t: series.hr.t.map((x) => Math.round(x)), v: series.hr.v.map((x) => Math.round(x)) } : null,
    hrSparse: isHrSparse(series.hr, run.durationS),
    distanceInfo: {
      kmFrom: kmFromGps ? "gps" : samplesM ? "samples" : gpsM ? "gps" : "none",
      samplesM,
      gpsM,
      totalM: run.distanceM,
      missing: miss.length
        ? { stretches: miss.length, gpsM: miss.reduce((a, m) => a + m.gpsM, 0), watchM: miss.reduce((a, m) => a + m.watchM, 0) }
        : null,
    },
    grade: st.ele
      ? gradeAlong(
          st.km.map((k) => (k === null ? null : k * 1000)),
          st.ele,
          60,
        ).map((g) => (g === null ? null : Math.round(g * 1000) / 1000))
      : null,
  };
}

// ─── Análisis ────────────────────────────────────────────────────────────────

export async function getAnalysis(band: [number, number], ctx: Ctx = makeCtx()) {
  const d = db();
  await ctx.classified();
  // Una sola ronda (antes eran tres en serie).
  const [vo2Rows, runRows, typeYearRows, byType12, byTypeAll] = await Promise.all([
    d.execute(sql`
      SELECT to_char((measured_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, avg(value) AS v
      FROM vo2max_readings GROUP BY 1 ORDER BY 1`),
    d
      .select({
        year: sql<number>`extract(year from ${s.runs.startAt} AT TIME ZONE ${TZ})::int`,
        distanceM: s.runs.distanceM,
        durationS: s.runs.durationS,
        avgHr: s.runs.avgHr,
        isSpecial: s.runs.isSpecial,
        inInjury: s.runs.inInjury,
      })
      .from(s.runs)
      .where(and(valid)),
    d.execute(sql`
      SELECT extract(year from start_at AT TIME ZONE ${TZ})::int AS y, coalesce(session_type_manual, session_type_auto) AS t,
             sum(distance_m) / 1000 AS km
      FROM runs WHERE status = 'valid' GROUP BY 1, 2`),
    kmByType(sql`start_at >= now() - interval '12 months'`),
    kmByType(sql`true`),
  ]);
  const vo2 = (vo2Rows.rows as { day: string; v: string }[]).map((r) => ({ day: r.day, value: Number(r.v) }));
  const thisYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: TZ }).format(new Date()));
  const firstYear = runRows.length ? Math.min(...runRows.map((r) => Number(r.year))) : thisYear;

  const kmByYear: { year: number; km: number; runs: number }[] = [];
  for (let y = firstYear; y <= thisYear; y++) {
    const ys = runRows.filter((r) => Number(r.year) === y);
    kmByYear.push({ year: y, km: ys.reduce((a, r) => a + (r.distanceM ?? 0), 0) / 1000, runs: ys.length });
  }
  // Las carreras en periodo de lesión no cuentan en medias de ritmo.
  const forPace = runRows.filter((r) => !r.inInjury).map((r) => ({ ...r, year: Number(r.year) }));
  const paceAtHr: YearPace[] = paceAtHrByYear(forPace, band, firstYear, thisYear);
  // Todas las franjas a la vez: el selector cambia en el cliente, sin volver al servidor.
  const paceAtHrByBand: Record<string, YearPace[]> = Object.fromEntries(
    HR_BANDS.map(([lo, hi]) => [`${lo}-${hi}`, paceAtHrByYear(forPace, [lo, hi], firstYear, thisYear)]),
  );
  const longest = runRows.reduce<number | null>((m, r) => (r.distanceM !== null && (m === null || r.distanceM > m) ? r.distanceM : m), null);
  const hrYears = runRows.filter((r) => r.avgHr !== null).map((r) => Number(r.year));
  const firstHrYear = hrYears.length ? Math.min(...hrYears) : null;
  const typeByYear = kmByYear.map((y) => {
    const row: Record<SessionType, number> = Object.fromEntries(SESSION_TYPES.map((t) => [t, 0])) as Record<SessionType, number>;
    for (const r of typeYearRows.rows as { y: number; t: string | null; km: string | null }[]) {
      if (r.y === y.year && isSessionType(r.t)) row[r.t] = Number(r.km ?? 0);
    }
    return { year: y.year, km: row };
  });
  return { vo2, kmByYear, paceAtHr, paceAtHrByBand, totalRuns: runRows.length, longestM: longest, firstHrYear, typeByYear, byType12, byTypeAll };
}

export async function getTrainingSettingsView(ctx: Ctx = makeCtx()) {
  const [types, zones] = await Promise.all([ctx.typeSettings(), ctx.zones()]);
  return { types, zones };
}

// ─── Periodos y objetivos ────────────────────────────────────────────────────

import { buildPeriods, comparePeriodToDate, localDay, goalProgress, suggestGoals, yearsSinceFirst, type PeriodUnit, type RunForPeriod } from "@/lib/analysis/periods";
import { getGoals } from "@/lib/analysis/goals-db";
import { listInjuries } from "@/lib/analysis/injuries-db";

async function runsForPeriods() {
  const rows = await db()
    .select({
      id: s.runs.id,
      avgPaceSPerKm: s.runs.avgPaceSPerKm,
      type: effectiveType,
      inInjury: s.runs.inInjury,
      startAt: s.runs.startAt,
      distanceM: s.runs.distanceM,
      durationS: s.runs.durationS,
      avgHr: s.runs.avgHr,
      isSpecial: s.runs.isSpecial,
      elevationGainM: s.runs.elevationGainM,
      trainingLoad: s.runs.trainingLoad,
      loadEstimated: s.runs.loadEstimated,
      hrZoneSeconds: s.runs.hrZoneSeconds,
    })
    .from(s.runs)
    .where(valid);
  return rows satisfies RunForPeriod[];
}

/** Tarjeta de objetivos de Inicio: semana y mes en curso. */
export async function getGoalsHome(ctx: Ctx = makeCtx()) {
  const [runs, goals] = await Promise.all([ctx.runs(), ctx.goals()]);
  const now = new Date();
  const week = buildPeriods(runs, "week", 1, now)[0];
  const month = buildPeriods(runs, "month", 1, now)[0];
  return {
    goals,
    week: goals.week.km && !goals.week.paused ? goalProgress(goals.week.km, week.km, "week", now) : null,
    month: goals.month.km && !goals.month.paused ? goalProgress(goals.month.km, month.km, "month", now) : null,
    weekKm: week.km,
    monthKm: month.km,
  };
}

/** Gráficos por periodo de Análisis. */
export async function getPeriodsView(unit: PeriodUnit, weeks: 12 | 26, ctx: Ctx = makeCtx()) {
  const [runs, goals, injuries] = await Promise.all([ctx.runs(), ctx.goals(), ctx.injuries()]);
  const count = unit === "week" ? weeks : unit === "month" ? 12 : yearsSinceFirst(runs);
  const periods = buildPeriods(runs, unit, count);
  const goal = goals[unit];
  // Mismo tramo del periodo anterior (no el periodo entero), sin carreras en lesión.
  const comparison = comparePeriodToDate(runs.filter((r) => !r.inInjury), unit);
  const today = new Date(localDay(new Date()) * 86_400_000).toISOString().slice(0, 10);
  const injuryRanges = periodInjuryRanges(
    periods.map((p) => p.start),
    injuries,
    today,
  );
  return { periods, comparison, goalKm: goal.km && !goal.paused ? goal.km : null, injuries, injuryRanges };
}

/** Las cuatro vistas del selector de Volumen (semana 12/26, mes, año), con los mismos datos. */
export async function getPeriodsAll(ctx: Ctx = makeCtx()) {
  const [week12, week26, month, year] = await Promise.all([
    getPeriodsView("week", 12, ctx),
    getPeriodsView("week", 26, ctx),
    getPeriodsView("month", 12, ctx),
    getPeriodsView("year", 12, ctx),
  ]);
  return { week12, week26, month, year };
}

export async function getGoalsSettings(ctx: Ctx = makeCtx()) {
  const [runs, goals] = await Promise.all([ctx.runs(), ctx.goals()]);
  return { goals, suggested: suggestGoals(runs.filter((r) => !r.inInjury)) };
}

// ─── Evolución del ritmo, calendario y comparación de años ───────────────────

import { bandsInYear, periodInjuryRanges } from "@/lib/analysis/injuries";
import { calendarDays, pacePoints, smoothTrend, yearToDate, type PacePoint, type PaceRange } from "@/lib/analysis/insights";

export async function getInsights(range: PaceRange, paceType: SessionType | null, ctx: Ctx = makeCtx()) {
  const [runs, injuries] = await Promise.all([ctx.runs(), ctx.injuries()]);
  const points = pacePoints(runs, range, paceType);
  const ytd = yearToDate(runs);
  const nowMs = Date.now();
  const bands = injuries.map((i) => ({ startDate: i.startDate, endDate: i.endDate }));
  return {
    points,
    nowMs,
    bands,
    yearBands: bandsInYear(bands, ytd.year, ytd.doy),
    // La tendencia y la comparación de años no usan las carreras en periodo de lesión.
    trend: smoothTrend(points.filter((p) => !p.inInjury)),
    calendar: calendarDays(runs),
    ytd,
    ytdNoInjury: yearToDate(runs.filter((r) => !r.inInjury)),
    injuries,
  };
}

// ─── Eficiencia aeróbica: ritmo en Z2 por carrera ────────────────────────────

/** Ritmo en Z2 de cada carrera de los últimos 6 meses (y su tendencia, sin lesiones). */
export async function getEfficiency(onlyType: SessionType | null, ctx: Ctx = makeCtx()) {
  await ctx.classified();
  const nowMs = Date.now();
  const from = new Date(nowMs - 182 * 86_400_000);
  const [rows, zones, injuries] = await Promise.all([
    db()
      .select({
        id: s.runs.id,
        startAt: s.runs.startAt,
        distanceM: s.runs.distanceM,
        pace: s.runs.efZ2PaceSPerKm,
        seconds: s.runs.efZ2Seconds,
        avgHr: s.runs.avgHr,
        type: effectiveType,
        inInjury: s.runs.inInjury,
      })
      .from(s.runs)
      .where(and(valid, sql`${s.runs.efZ2PaceSPerKm} IS NOT NULL`, sql`${s.runs.startAt} >= ${from}`))
      .orderBy(asc(s.runs.startAt)),
    ctx.zones(),
    ctx.injuries(),
  ]);
  const points: PacePoint[] = rows
    .filter((r) => !onlyType || r.type === onlyType)
    .map((r) => ({
      id: r.id,
      t: r.startAt.getTime(),
      pace: r.pace!,
      km: (r.distanceM ?? 0) / 1000,
      avgHr: r.avgHr,
      type: r.type,
      inInjury: r.inInjury,
    }));
  const trend = smoothTrend(points.filter((p) => !p.inInjury));
  return {
    points,
    trend,
    band: z2Band(zones.limits),
    // Cambio de la tendencia del primer al último punto (negativo = más rápido al mismo pulso).
    changeS: trend.length >= 2 ? trend[trend.length - 1].pace - trend[0].pace : null,
    bands: injuries.map((i) => ({ startDate: i.startDate, endDate: i.endDate })),
    nowMs,
  };
}

// ─── Récords personales ──────────────────────────────────────────────────────


export async function getRecords(ctx: Ctx = makeCtx()) {
  await ctx.classified();
  const rows = await db()
    .select({
      key: s.runEfforts.key,
      timeS: s.runEfforts.timeS,
      startS: s.runEfforts.startS,
      runId: s.runEfforts.runId,
      startAt: s.runs.startAt,
      runDistanceM: s.runs.distanceM,
      inInjury: s.runs.inInjury,
    })
    .from(s.runEfforts)
    .innerJoin(s.runs, and(eq(s.runs.id, s.runEfforts.runId), valid));
  return EFFORT_DISTANCES.map((d) => {
    const mine = rows.filter((r) => r.key === d.key);
    const best = mine.reduce<(typeof mine)[number] | null>((b, r) => (!b || r.timeS < b.timeS ? r : b), null);
    const recent = !!best && best.startAt.getTime() >= Date.now() - 365 * 86_400_000;
    return { ...d, best, attempts: mine.length, recent };
  });
}

export async function getRecordHistory(key: EffortKey) {
  const rows = await db()
    .select({ runId: s.runEfforts.runId, timeS: s.runEfforts.timeS, startAt: s.runs.startAt, inInjury: s.runs.inInjury })
    .from(s.runEfforts)
    .innerJoin(s.runs, and(eq(s.runs.id, s.runEfforts.runId), valid))
    .where(eq(s.runEfforts.key, key));
  const points = recordProgression(rows.map((r) => ({ ...r, key })));
  const injuries = await listInjuries(db());
  const nowMs = Date.now();
  const recentRecords = points.filter((p) => p.isRecord && p.startAt.getTime() >= nowMs - 365 * 86_400_000).length;
  return { points, improvement: improvementPct(points), injuries, recentRecords, nowMs };
}

/** Periodos de lesión con el número de carreras válidas dentro, para Perfil. */
export async function getInjuriesView(ctx: Ctx = makeCtx()) {
  const [injuries, counts] = await Promise.all([
    ctx.injuries(),
    db().execute<{ id: string; n: number }>(sql`
    SELECT i.id, count(r.id)::int AS n FROM injuries i
    LEFT JOIN runs r ON r.status = 'valid'
      AND (r.start_at AT TIME ZONE 'Europe/Madrid')::date >= i.start_date
      AND (i.end_date IS NULL OR (r.start_at AT TIME ZONE 'Europe/Madrid')::date <= i.end_date)
    GROUP BY i.id`),
  ]);
  const n = new Map(counts.rows.map((r) => [r.id, Number(r.n)]));
  const today = new Date(localDay(new Date()) * 86_400_000).toISOString().slice(0, 10);
  return { injuries: injuries.map((i) => ({ id: i.id, startDate: i.startDate, endDate: i.endDate, note: i.note, runs: n.get(i.id) ?? 0 })), today };
}

// ─── Carreras manuales: edición ─────────────────────────────────────────────

/** Valores del formulario para editar una carrera manual (null si no existe o no es manual). */
export async function getManualForEdit(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [rows, feeling] = await Promise.all([db().select().from(s.runs).where(eq(s.runs.id, id)).limit(1), getFeeling(db(), id)]);
  const r = rows[0];
  if (!r || r.source !== "manual") return null;
  const { dateToMadrid } = await import("@/lib/manual/manual");
  const { date, time } = dateToMadrid(r.startAt);
  const d = Math.round(r.durationS);
  const n = (v: number | null, digits = 0) => (v === null ? "" : (Math.round(v * 10 ** digits) / 10 ** digits).toString().replace(".", ","));
  return {
    id: r.id,
    existingFile: r.routeFile,
    feeling,
    values: {
      date,
      time,
      distanceKm: r.distanceM === null ? "" : (r.distanceM / 1000).toString().replace(".", ","),
      h: String(Math.floor(d / 3600)),
      m: String(Math.floor((d % 3600) / 60)),
      s: String(d % 60),
      avgHr: n(r.avgHr),
      maxHr: n(r.maxHr),
      elevationGainM: n(r.elevationGainM),
      cadenceSpm: n(r.cadenceSpm),
      avgPowerW: n(r.avgPowerW),
      temperatureC: n(r.temperatureC, 1),
      sessionType: r.sessionTypeManual ?? "auto",
      isIndoor: !!r.isIndoor,
    },
  };
}

// ─── Inicio (rediseño) ───────────────────────────────────────────────────────

/** Todo lo de Inicio en una llamada: hoy, semana, mes, lesión abierta, récords y eficiencia. */
export async function getHomeOverview(ctx: Ctx = makeCtx()) {
  const now = new Date();
  const [runs, goals, injuries, records, efficiency, anchor, overrides] = await Promise.all([
    ctx.runs(),
    ctx.goals(),
    ctx.injuries(),
    getRecords(ctx),
    getEfficiency("rodaje", ctx),
    ctx.shiftAnchor(),
    ctx.shiftOverrides(),
  ]);
  const { recommendToday, weekDays } = await import("@/lib/analysis/home");
  const today = new Date(localDay(now) * 86_400_000).toISOString().slice(0, 10);
  const openInjury = injuries.find((i) => i.startDate <= today && (i.endDate === null || i.endDate >= today)) ?? null;
  const recent = runs.filter((r) => r.startAt.getTime() >= now.getTime() - 60 * 86_400_000);
  const fitness = buildFitnessView(fitnessRuns(runs), now, !!openInjury);
  // Turno efectivo de hoy (con los cambios de día).
  const td = dayNum(today)!;
  const todayShift = anchor
    ? { kind: shiftOn(anchor, today, overrides), changed: today in overrides, night: nightOn(anchor, td, overrides), afterNight: afterNightOn(anchor, td, overrides) }
    : null;
  const cur = fitness.current;
  const advice = recommendToday({
    runs: recent,
    openInjury: !!openInjury,
    now,
    fitness: cur ? { ratio: cur.ratio, form: cur.form, chronic: cur.chronic, enough: !cur.warmup } : null,
    shift: todayShift ? { night: todayShift.night, afterNight: todayShift.afterNight } : null,
  });

  const week = buildPeriods(runs, "week", 1, now)[0];
  const month = buildPeriods(runs, "month", 1, now)[0];
  const monthCmp = comparePeriodToDate(runs.filter((r) => !r.inInjury), "month", now);
  return {
    openInjury: openInjury ? { startDate: openInjury.startDate, note: openInjury.note } : null,
    advice,
    todayShift,
    week: {
      days: weekDays(runs, now),
      km: week.km,
      goal: goals.week.km && !goals.week.paused ? goalProgress(goals.week.km, week.km, "week", now) : null,
    },
    month: {
      km: month.km,
      runs: month.runs,
      goal: goals.month.km && !goals.month.paused ? goalProgress(goals.month.km, month.km, "month", now) : null,
      cmp: monthCmp,
    },
    recentRecords: records.filter((r) => r.best && r.recent).map((r) => ({ key: r.key, label: r.label, m: r.m, timeS: r.best!.timeS, startAt: r.best!.startAt, runId: r.best!.runId })),
    fitness: cur
      ? {
          ...cur,
          openInjury: !!openInjury,
          last28: fitness.cols.date.slice(-28).map((date, i, a) => {
            const k = fitness.cols.date.length - a.length + i;
            return { date, acute: fitness.cols.acute[k], chronic: fitness.cols.chronic[k] };
          }),
        }
      : null,
    efficiency: {
      points: efficiency.points.map((p) => ({ t: p.t, pace: p.pace })),
      last: efficiency.points.at(-1) ?? null,
      changeS: efficiency.changeS,
      band: efficiency.band,
    },
  };
}

// ─── Carga y forma ───────────────────────────────────────────────────────────

import { buildFitnessView, type FitnessRunIn } from "@/lib/analysis/fitness";

function fitnessRuns(runs: Awaited<ReturnType<typeof runsForPeriods>>): FitnessRunIn[] {
  return runs.map((r) => ({ id: r.id, startAt: r.startAt, load: r.trainingLoad, estimated: r.loadEstimated, distanceM: r.distanceM, type: r.type }));
}

/** Carga y forma de los últimos 12 meses (el selector 3/6/12 recorta en el cliente). */
export async function getFitness(ctx: Ctx = makeCtx()) {
  const now = new Date();
  const [runs, injuries] = await Promise.all([ctx.runs(), ctx.injuries()]);
  const today = new Date(localDay(now) * 86_400_000).toISOString().slice(0, 10);
  const open = injuries.some((i) => i.startDate <= today && (i.endDate === null || i.endDate >= today));
  return buildFitnessView(fitnessRuns(runs), now, open);
}

// ─── Plan ────────────────────────────────────────────────────────────────────

import { afterNightOn, dayNum, mondayOfDay, nightOn, shiftOn, shiftWeek, shiftWeeks, ymdOf, type ShiftWeek } from "@/lib/plan/shifts";
import { buildCalendar, type CalendarBlock, type PlanDone } from "@/lib/plan/calendar";
import { pickSources, predictAt, predictionHistory } from "@/lib/plan/predict";
import { SESSION_LABEL, demandingOf, fmtDay, planWeeks, type SessionKind } from "@/lib/plan/weekly";
import { rescheduleDay, weekStatus } from "@/lib/plan/compliance";
import { freezeWeek, getStoredWeeks, listMine, type MineRow } from "@/lib/plan/plan-db";
import { MINE_LABEL, mineDetail, weekOf, type MineKind } from "@/lib/plan/mine";
import { linkMode, manualOf, manualWeekStatus, type LinkMode } from "@/lib/plan/linking";
import { assignRuns, doneWhen, mineStatus, slotMatches, unplannedRuns, type MineStatus, type PlanSlot } from "@/lib/plan/linking";
import { TYPE_META as RUN_TYPE_META, isSessionType as isRunType } from "@/lib/analysis/session-type";
import { pace as fmtPace } from "@/lib/format";
import { MINE_WHAT, RUN_WHAT, SUGG_WHAT, mineWarnings, type Exigente, type WarnCtx } from "@/lib/plan/warnings";

export interface MineView {
  id: string;
  date: string;
  dayLabel: string;
  week: string;
  kind: MineKind;
  label: string;
  detail: string | null;
  note: string | null;
  replacesWeek: string | null;
  /** choques con las reglas (se guarda igual) */
  warnings: string[];
  /** prevista frente a realizada (vinculación ±1 día) */
  status: MineStatus;
  done: RunBrief | null;
  /** días de la carrera respecto al día previsto (negativo = hecha antes); null sin carrera */
  doneOffset: number | null;
  /** «Hecha antes (jueves 26)» / «Hecha después (lunes 23)»; null si fue el mismo día o sin carrera */
  doneWhen: string | null;
  /** ritmo previsto si puse distancia y duración */
  plannedPace: string | null;
  plannedKm: string | null;
  distanceM: number | null;
  durationS: number | null;
  /** vínculo con su carrera: automático, manual o «Desvincular» */
  link: LinkMode;
  /** para el reparto: id de carrera (manual), null (desvinculada) o undefined (automático) */
  manual: string | null | undefined;
}
/** Una carrera hecha, en una línea. */
export interface RunBrief {
  id: string;
  date: string;
  dayLabel: string;
  typeLabel: string;
  km: string | null;
  pace: string | null;
}
const mineView = (m: MineRow): MineView => ({
  warnings: [],
  distanceM: m.distanceM,
  durationS: m.durationS,
  status: "pendiente",
  done: null,
  doneOffset: null,
  doneWhen: null,
  plannedPace: m.distanceM && m.durationS ? fmtPace(m.durationS / (m.distanceM / 1000)) : null,
  plannedKm: m.distanceM ? (m.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : null,
  id: m.id,
  date: m.date,
  dayLabel: fmtDay(m.date),
  week: weekOf(m.date),
  kind: m.kind as MineKind,
  label: MINE_LABEL[m.kind as MineKind] ?? m.kind,
  detail: mineDetail(m),
  note: m.note,
  replacesWeek: m.replacesWeek,
  link: linkMode(m),
  manual: manualOf(m),
});
/** Por qué no se muestra la sugerencia de una semana. */
export type Hidden = { by: "dismissed" } | { by: "replaced"; id: string };

function mineExigentes(mine: readonly MineView[]): Exigente[] {
  return mine.flatMap((m) => {
    const k = demandingOf(m.kind);
    return k ? [{ date: m.date, kind: k, what: MINE_WHAT[m.kind], id: m.id }] : [];
  });
}

/** Mis sesiones de un día (para Inicio), con su estado (misma vinculación por semana que en Plan). */
export async function getMineOn(day: string, ctx: Ctx = makeCtx()): Promise<(MineView & { distanceM: number | null; durationS: number | null })[]> {
  // El mismo reparto por semana que en Plan (mis sesiones y la sugerencia visible de la semana).
  const core = await planCore(day, ctx, { weeksAhead: 1 });
  if (!core.anchor) {
    const d = dayNum(day)!;
    const monday = mondayOfDay(d);
    const rows = (await listMine(db(), ymdOf(monday - 1), ymdOf(monday + 7))).map(mineView);
    if (!rows.some((m) => m.date === day)) return [];
    const lite = core.runs
      .map((r) => ({ id: r.id, date: core.madrid(r.startAt), at: r.startAt.getTime(), type: r.type, distanceM: r.distanceM, durationS: r.durationS }))
      .filter((r) => r.date >= ymdOf(monday - 2) && r.date <= day);
    const assigned = assignRuns(rows, lite);
    return rows.filter((m) => m.date === day).map((m) => withDone(m, assigned.get(m.id), day));
  }
  const mine = core.mine.filter((m) => m.date === day);
  if (!mine.length) return [];
  const w = core.sessions[0];
  const row = core.byStart.get(w.start);
  const { assigned } = planLinks(core, day, core.pastStart, core.hidden[w.start] ? [] : [{ week: w.start, day: w.day, session: w.session, manual: row ? manualOf(row) : undefined }]);
  return mine.map((m) => withDone(m, assigned.get(m.id), day));
}

/** Mi sesión con su carrera (si la cubre una, aunque sea otro día de su semana). */
function withDone(
  m: MineView,
  l: { run: { id: string; date: string; at: number; type: string | null; distanceM: number | null; durationS: number }; offset: number } | undefined,
  day: string,
): MineView & { distanceM: number | null; durationS: number | null } {
  const r = l?.run;
  return {
    ...m,
    status: mineStatus(m, r, day),
    doneOffset: l ? l.offset : null,
    doneWhen: doneWhen(l),
    done: r
      ? {
          id: r.id,
          date: r.date,
          dayLabel: fmtDay(r.date),
          typeLabel: r.type && isRunType(r.type) ? RUN_TYPE_META[r.type].label : "Sin tipo",
          km: r.distanceM ? (r.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : null,
          pace: r.distanceM && r.durationS ? fmtPace(r.durationS / (r.distanceM / 1000)) : null,
        }
      : null,
  };
}

/** Ciclo de turnos: semanas desde la actual (incluida) y la anterior, para Plan. */
/**
 * Núcleo del plan, compartido por Plan (Resumen) y el Calendario: semanas sugeridas desde la
 * actual (`weeksAhead`), semanas guardadas, mis sesiones desde `from` y qué sugerencias no se
 * muestran (quitadas o sustituidas por una sesión mía).
 */
async function planCore(today: string, ctx: Ctx, o: { weeksAhead: number; from?: string }) {
  const [anchor, runs, fitness, raceRows, overrides] = await Promise.all([ctx.shiftAnchor(), ctx.runs(), getFitness(ctx), ctx.races(), ctx.shiftOverrides()]);
  const raceList = raceRows.map((r) => ({ name: r.name, date: r.date }));
  const madrid = (d: Date) => new Date(localDay(d) * 86_400_000).toISOString().slice(0, 10);
  const history = runs.map((r) => ({ date: madrid(r.startAt), type: r.type }));
  const weeks: ShiftWeek[] = anchor ? shiftWeeks(anchor, today, Math.max(1, o.weeksAhead)) : [];
  if (!anchor || !weeks.length) return { anchor: null, runs, raceRows, raceList, history, madrid, overrides } as const;
  const pastStart = ymdOf(weeks[0].startDay - 28);
  const from = o.from && o.from < pastStart ? o.from : pastStart;
  const [stored, mineRows] = await Promise.all([getStoredWeeks(db(), from, weeks[weeks.length - 1].start), listMine(db(), from, ymdOf(dayNum(today)! + 365))]);
  const byStart = new Map(stored.map((r) => [r.weekStart, r]));
  const mine = mineRows.map(mineView);
  const hidden: Record<string, Hidden> = {};
  for (const r of stored) if (r.dismissed) hidden[r.weekStart] = { by: "dismissed" };
  for (const m of mine) if (m.replacesWeek && !hidden[m.replacesWeek]) hidden[m.replacesWeek] = { by: "replaced", id: m.id };
  const fixed = Object.fromEntries(
    stored.filter((r) => !r.dismissed).map((r) => [r.weekStart, { session: r.session as SessionKind, day: r.day, when: r.whenText, reason: r.reason, downgraded: r.downgraded }]),
  );
  const cur = fitness.current;
  const sessions = planWeeks({
    weeks,
    anchor,
    today,
    history,
    ratio: cur && !cur.warmup ? cur.ratio : null,
    openInjury: fitness.openInjury,
    fixed,
    races: raceList,
    mine: mine.map((m) => ({ id: m.id, date: m.date, kind: m.kind })),
    overrides,
  });
  // Una exigente mía ocupa el sitio de la sugerencia de su semana.
  for (const w of sessions) if (w.occupiedBy && !hidden[w.start]) hidden[w.start] = { by: "replaced", id: w.occupiedBy };
  return { anchor, runs, raceRows, raceList, history, madrid, weeks, pastStart, stored, byStart, mine, hidden, sessions, overrides } as const;
}

/** Contexto de avisos: otras exigentes (mías, sugeridas visibles desde hoy y corridas), carreras y ciclo. */
function warnContext(core: Extract<Awaited<ReturnType<typeof planCore>>, { weeks: unknown }>, today: string): WarnCtx {
  const { anchor, mine, sessions, hidden, pastStart, raceList, overrides, runs, madrid } = core;
  const exigentes: Exigente[] = [
    ...mineExigentes(mine),
    ...sessions.flatMap((w) => {
      const k = demandingOf(w.session);
      return k && !hidden[w.start] && w.day >= today ? [{ date: w.day, kind: k, what: SUGG_WHAT[k] }] : [];
    }),
    ...runs.flatMap((r) => {
      const k = demandingOf(r.type);
      const date = madrid(r.startAt);
      return k && date >= pastStart && date <= today ? [{ date, kind: k, what: RUN_WHAT[k], runId: r.id }] : [];
    }),
  ];
  return { anchor, races: raceList, exigentes, overrides };
}

/**
 * Prevista frente a realizada, por semana: un único reparto de carreras (hasta hoy) entre mis
 * sesiones y las sugerencias visibles (`sug:<lunes>`); una carrera cubre como máximo una sesión.
 */
function planLinks(
  core: Extract<Awaited<ReturnType<typeof planCore>>, { weeks: unknown }>,
  today: string,
  from: string,
  suggestions: readonly { week: string; day: string; session: SessionKind; manual?: string | null }[],
) {
  const lite = core.runs
    .map((r) => ({ id: r.id, date: core.madrid(r.startAt), at: r.startAt.getTime(), type: r.type, distanceM: r.distanceM, durationS: r.durationS }))
    .filter((r) => r.date >= ymdOf(dayNum(from)! - 1) && r.date <= today);
  const slots: PlanSlot[] = [
    ...core.mine.map((m) => ({ id: m.id, date: m.date, kind: m.kind, manual: m.manual })),
    ...suggestions.filter((g) => g.week <= today).map((g) => ({ id: `sug:${g.week}`, date: g.day, kind: g.session, manual: g.manual })),
  ];
  const assigned = assignRuns(slots, lite);
  const mineRunIds = new Set(core.mine.flatMap((m) => (assigned.get(m.id) ? [assigned.get(m.id)!.run.id] : [])));
  return { lite, assigned, mineRunIds };
}

/** Calendario: marcas de cada día entre `from` y `to` (lunes y domingo de las cuadrículas). */
export async function getCalendar(today: string, from: string, to: string, ctx: Ctx = makeCtx()): Promise<CalendarBlock> {
  const t = dayNum(today)!;
  const weeksAhead = Math.ceil((dayNum(to)! - mondayOfDay(t)) / 7) + 1;
  const [core, injuries] = await Promise.all([planCore(today, ctx, { weeksAhead, from }), ctx.injuries()]);
  const runs = core.runs.map((r) => ({ id: r.id, date: core.madrid(r.startAt), distanceM: r.distanceM, type: r.type, paceS: r.isSpecial ? null : r.avgPaceSPerKm }));
  if (!core.anchor) {
    const mine = (await listMine(db(), from, to)).map(mineView);
    return buildCalendar({ from, to, shiftOf: null, suggestions: [], mine, runs, races: core.raceList, injuries, today, overrides: core.overrides });
  }
  const { anchor, sessions, stored, hidden, mine } = core;
  const warnCtx = warnContext(core, today);
  for (const m of mine) m.warnings = mineWarnings(m, warnCtx);
  const current = sessions[0].start;
  const mineExigWeeks = new Set(mine.filter((m) => demandingOf(m.kind)).map((m) => m.week));
  const visible = [
    // semanas pasadas: solo las guardadas, si no se quitaron ni las sustituyó una sesión mía
    ...stored
      .filter((r) => r.weekStart < current && !hidden[r.weekStart] && !mineExigWeeks.has(r.weekStart))
      .map((r) => ({ day: r.day, session: r.session as SessionKind, week: r.weekStart, manual: manualOf(r) })),
    ...sessions.filter((w) => !hidden[w.start]).map((w) => ({ day: w.day, session: w.session, week: w.start, manual: core.byStart.get(w.start) ? manualOf(core.byStart.get(w.start)!) : undefined })),
  ];
  // Qué carrera cubre cada sesión prevista (mismo reparto por semana que en Plan).
  const { assigned } = planLinks(core, today, from < core.pastStart ? from : core.pastStart, visible);
  const doneOf = (id: string, kind: string): PlanDone | null => {
    const l = assigned.get(id);
    return l ? { date: l.run.date, offset: l.offset, matched: slotMatches(kind, l.run.type), when: doneWhen(l) } : null;
  };
  const suggestions = visible.map((g) => ({ ...g, covered: doneOf(`sug:${g.week}`, g.session) }));
  const covering = Object.fromEntries(mine.flatMap((m) => (assigned.get(m.id) ? [[m.id, assigned.get(m.id)!.run.id]] : [])));
  for (const m of mine) m.warnings = mineWarnings(m, { ...warnCtx, covering });
  const mineDone = mine.map((m) => ({ ...m, covered: doneOf(m.id, m.kind) }));
  return buildCalendar({ from, to, shiftOf: (m) => shiftWeek(anchor, m).kind, suggestions, mine: mineDone, runs, races: core.raceList, injuries, today, overrides: core.overrides });
}

export async function getPlan(today: string, ctx: Ctx = makeCtx()) {
  const [predictions, core] = await Promise.all([getPredictions(ctx), planCore(today, ctx, { weeksAhead: 10 })]);
  const { anchor, runs, raceRows, raceList } = core;
  const races = await withRaceResults(raceViews(raceRows, today, predictions), runs);
  const weeks: ShiftWeek[] = core.anchor ? core.weeks : [];
  if (!core.anchor || !anchor) {
    const mine = (await listMine(db(), today, ymdOf(dayNum(today)! + 365))).map(mineView);
    const warnCtx: WarnCtx = { anchor: null, races: raceList, exigentes: mineExigentes(mine) };
    for (const m of mine) m.warnings = mineWarnings(m, warnCtx);
    return { anchor, today, weeks, sessions: [], current: null, past: [], predictions, races, mine, hidden: {} as Record<string, Hidden>, warnCtx, unplanned: {} as Record<string, RunBrief[]>, overrides: core.overrides, weekRuns: {} as Record<string, RunBrief[]> };
  }

  const { pastStart, byStart, mine, hidden, sessions } = core;

  // Avisos de mis sesiones frente a las reglas (otras exigentes: mías, sugeridas visibles y corridas).
  const warnCtx = warnContext(core, today);
  for (const m of mine) m.warnings = mineWarnings(m, warnCtx);

  // La semana en curso se congela la primera vez que se ve: ya no cambia al recalcular.
  const now = sessions[0];
  if (!byStart.has(now.start)) await freezeWeek(db(), now);
  const nowRow = byStart.get(now.start);
  // Prevista frente a realizada (por semana): mis sesiones y la sugerencia visible de cada semana.
  const pastWeeks = [1, 2, 3, 4].map((k) => shiftWeek(anchor, ymdOf(weeks[0].startDay - 7 * k)));
  const sugManual = (week: string) => (byStart.get(week) ? manualOf(byStart.get(week)!) : undefined);
  const { lite, assigned, mineRunIds } = planLinks(core, today, pastStart, [
    ...sessions.filter((w) => !hidden[w.start]).map((w) => ({ week: w.start, day: w.day, session: w.session, manual: sugManual(w.start) })),
    ...pastWeeks.flatMap((w) => {
      const r = byStart.get(w.start);
      return r && !hidden[w.start] ? [{ week: w.start, day: r.day, session: r.session as SessionKind, manual: sugManual(w.start) }] : [];
    }),
  ]);
  /** Estado de la sugerencia: lo manual manda; si no, el cálculo por semana de siempre. */
  const sugStatus = (week: string, session: SessionKind, day: string) =>
    manualWeekStatus(session, sugManual(week), assigned.get(`sug:${week}`)?.run, () => weekStatus({ session, day, weekStart: week, today, runs: [] })) ??
    weekStatus({ session, day, weekStart: week, today, runs: sugHistory });
  // La sugerida se juzga sin las carreras que ya cubren mis sesiones.
  const sugHistory = lite.filter((r) => !mineRunIds.has(r.id)).map((r) => ({ date: r.date, type: r.type }));
  const brief = (r: (typeof lite)[number]): RunBrief => ({
    id: r.id,
    date: r.date,
    dayLabel: fmtDay(r.date),
    typeLabel: r.type && isRunType(r.type) ? RUN_TYPE_META[r.type].label : "Sin tipo",
    km: r.distanceM ? (r.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : null,
    pace: r.distanceM && r.durationS ? fmtPace(r.durationS / (r.distanceM / 1000)) : null,
  });
  /** Carrera que cubre la sugerencia de una semana (si la hay y es de su tipo). */
  const sugDone = (week: string) => {
    const l = assigned.get(`sug:${week}`);
    const kind = sessions.find((w) => w.start === week)?.session ?? byStart.get(week)?.session;
    return l && kind && slotMatches(kind, l.run.type) ? { run: brief(l.run), when: doneWhen(l) } : null;
  };
  const status = sugStatus(now.start, now.session, now.day);
  const latest = now.race ? ymdOf(dayNum(now.race.date)! - 2) : null;
  const newDay = status === "dia_pasado" ? rescheduleDay({ anchor, kind: now.kind, session: now.session, weekStart: now.start, today, latest, overrides: core.overrides }) : null;
  const current = {
    ...now,
    status,
    rescheduledFrom: nowRow?.rescheduledFrom ?? null,
    canReschedule: newDay !== null && newDay !== now.day,
    rescheduleTo: newDay,
    hidden: hidden[now.start] ?? null,
    done: status === "cumplida" ? sugDone(now.start) : null,
    link: nowRow ? linkMode(nowRow) : ("auto" as LinkMode),
    linkedRunId: assigned.get(`sug:${now.start}`)?.run.id ?? null,
  };

  // Las 4 semanas anteriores, con la sugerencia guardada (si la hubo) y su resultado.
  const past = pastWeeks.map((w) => {
    const r = byStart.get(w.start);
    const session = r ? (r.session as SessionKind) : null;
    return {
      start: w.start,
      end: w.end,
      kind: w.kind,
      sug:
        r && session
          ? (() => {
              const st = sugStatus(w.start, session, r.day);
              return { session, label: SESSION_LABEL[session], day: r.day, dayLabel: fmtDay(r.day), status: st, done: st === "cumplida" ? sugDone(w.start) : null, link: linkMode(r), linkedRunId: assigned.get(`sug:${w.start}`)?.run.id ?? null };
            })()
          : null,
      hidden: hidden[w.start] ?? null,
    };
  });

  for (const m of mine) {
    const l = assigned.get(m.id);
    m.status = mineStatus(m, l?.run, today);
    m.done = l ? brief(l.run) : null;
    m.doneOffset = l ? l.offset : null;
    m.doneWhen = doneWhen(l);
  }
  // Con el reparto hecho, los avisos saben qué carrera cubre cada sesión mía.
  const covering = Object.fromEntries(mine.flatMap((m) => (assigned.get(m.id) ? [[m.id, assigned.get(m.id)!.run.id]] : [])));
  for (const m of mine) m.warnings = mineWarnings(m, { ...warnCtx, covering });
  const sugBy = new Map<string, SessionKind>();
  for (const w of sessions) if (!hidden[w.start] && sugManual(w.start) === undefined) sugBy.set(w.start, w.session);
  for (const w of past) if (w.sug && !w.hidden && sugManual(w.start) === undefined) sugBy.set(w.start, w.sug.session);
  const linkedIds = new Set([...mineRunIds, ...[...assigned].filter(([k, l]) => k.startsWith("sug:") && l.manual).map(([, l]) => l.run.id)]);
  const unplanned: Record<string, RunBrief[]> = {};
  for (const r of unplannedRuns(lite, linkedIds, sugBy, weekOf)) (unplanned[weekOf(r.date)] ??= []).push(brief(r));
  // Carreras de cada semana (para «Vincular con una carrera de esta semana»).
  const weekRuns: Record<string, RunBrief[]> = {};
  for (const r of [...lite].sort((a, b) => a.at - b.at)) (weekRuns[weekOf(r.date)] ??= []).push(brief(r));

  return { anchor, today, weeks, sessions, current, past, predictions, races, mine, hidden, warnCtx, unplanned, overrides: core.overrides, weekRuns };
}

/** Predicción de marcas de hoy y su evolución mensual (24 meses), con los datos de cada momento. */
export async function getPredictions(ctx: Ctx = makeCtx()) {
  const [efforts, runs] = await Promise.all([
    db()
      .select({ key: s.runEfforts.key, timeS: s.runEfforts.timeS, startAt: s.runs.startAt, runId: s.runEfforts.runId })
      .from(s.runEfforts)
      .innerJoin(s.runs, and(eq(s.runs.id, s.runEfforts.runId), valid)),
    ctx.runs(),
  ]);
  const now = Date.now();
  const e = efforts.map((x) => ({ key: x.key, timeS: x.timeS, at: x.startAt.getTime(), runId: x.runId }));
  const r = runs.map((x) => ({ at: x.startAt.getTime(), distanceM: x.distanceM }));
  const longestM = r.filter((x) => now - x.at <= 365 * 86_400_000).reduce((m, x) => Math.max(m, x.distanceM ?? 0), 0);
  return { now: predictAt(e, r, now), history: predictionHistory(e, r, now, 24), longestM, sources: pickSources(e, now) };
}

// ─── Sensaciones ─────────────────────────────────────────────────────────────

import { feelingStats } from "@/lib/feelings/stats";
import type { FeelingTag } from "@/lib/feelings/feelings";

/** Sensaciones de las carreras válidas: media por mes y etiquetas junto a peores y mejores. */
export async function getFeelingStats(today: string) {
  const rows = await db()
    .select({ startAt: s.runs.startAt, rating: s.runFeelings.rating, tags: s.runFeelings.tags })
    .from(s.runFeelings)
    .innerJoin(s.runs, and(eq(s.runs.id, s.runFeelings.runId), valid));
  return feelingStats(
    rows.map((r) => ({ date: new Date(localDay(r.startAt) * 86_400_000).toISOString().slice(0, 10), rating: r.rating, tags: (r.tags ?? []) as FeelingTag[] })),
    today,
  );
}

// ─── Carreras objetivo ───────────────────────────────────────────────────────

import { RACE_DISTANCES, daysUntil, realism, type RaceDistanceKey, type RaceProfile } from "@/lib/race/race";
import { predictDistance, type Prediction } from "@/lib/plan/predict";
import type { RaceRow } from "@/lib/race/race-db";

/** Predicción para la distancia de la carrera: la de Plan si es estándar, si no, Riegel a esa distancia. */
function predictionFor(m: number, key: string, p: Awaited<ReturnType<typeof getPredictions>>): Prediction | null {
  const std = p.now.find((x) => x.key === key && key in RACE_DISTANCES);
  return std ?? predictDistance(m, p.sources, p.longestM);
}

export function raceViews(rows: readonly RaceRow[], today: string, p: Awaited<ReturnType<typeof getPredictions>>) {
  return rows
    .map((r) => {
      const pred = predictionFor(r.distanceM, r.distanceKey, p);
      return {
        id: r.id,
        name: r.name,
        date: r.date,
        distanceKey: r.distanceKey as RaceDistanceKey,
        distanceM: r.distanceM,
        startTime: r.startTime,
        targetS: r.targetS,
        strategy: r.strategy,
        profile: (r.profile ?? null) as RaceProfile | null,
        runId: r.runId,
        days: daysUntil(r.date, today),
        prediction: pred ? { timeS: pred.timeS, lowS: pred.lowS, highS: pred.highS, confidence: pred.confidence } : null,
        realism: realism(r.targetS, pred),
      };
    })
    .sort((a, b) => (a.days < 0) === (b.days < 0) ? (a.days < 0 ? b.days - a.days : a.days - b.days) : a.days < 0 ? 1 : -1);
}
export type RaceView = ReturnType<typeof raceViews>[number];

/** Próxima carrera objetivo (hoy o después), para Inicio. */
export async function getNextRace(today: string, ctx: Ctx = makeCtx()) {
  const [rows, p] = await Promise.all([ctx.races(), getPredictions(ctx)]);
  return raceViews(rows, today, p).find((r) => r.days >= 0) ?? null;
}

/**
 * Carreras ya corridas (hoy o antes): si están vinculadas, la carrera real y sus parciales; si
 * no, las carreras de ese día para «Vincular».
 */
async function withRaceResults(races: RaceView[], runs: Awaited<ReturnType<typeof runsForPeriods>>) {
  const madridYmd = (d: Date) => new Date(localDay(d) * 86_400_000).toISOString().slice(0, 10);
  const linked = races.filter((r) => r.runId).map((r) => r.runId!);
  const splits = linked.length
    ? await db()
        .select({ runId: s.runSplits.runId, idx: s.runSplits.idx, distanceM: s.runSplits.distanceM, durationS: s.runSplits.durationS })
        .from(s.runSplits)
        .where(sql`${s.runSplits.runId} IN (${sql.join(linked.map((x) => sql`${x}`), sql`, `)})`)
    : [];
  const byRun = new Map(runs.map((r) => [r.id, r]));
  return races.map((r) => {
    if (r.days > 0) return { ...r, actual: null, candidates: [] };
    const run = r.runId ? byRun.get(r.runId) : undefined;
    return {
      ...r,
      actual: run
        ? {
            runId: run.id,
            durationS: run.durationS,
            distanceM: run.distanceM,
            type: run.type,
            splits: splits.filter((x) => x.runId === run.id).map((x) => ({ idx: x.idx, distanceM: x.distanceM, durationS: x.durationS })),
          }
        : null,
      candidates: r.runId
        ? []
        : runs
            .filter((x) => madridYmd(x.startAt) === r.date)
            .map((x) => ({ id: x.id, distanceM: x.distanceM, durationS: x.durationS, type: x.type, startAt: x.startAt.toISOString() })),
    };
  });
}

// ─── Resumen de la semana ────────────────────────────────────────────────────

import { summarizeWeek, type WeekPlanItem, type WeekRun, type WeekSummary } from "@/lib/analysis/week-summary";
import { addDaysYmd, mondayOf } from "@/lib/analysis/week-dates";

export interface WeekReport {
  summary: WeekSummary;
  plan: WeekPlanItem[];
  runs: (WeekRun & { pace: string | null; dayLabel: string })[];
}

/**
 * Resumen de cada semana pedida (lunes; la en curso como mucho): cifras, frases y previsto
 * frente a realizado con el mismo cumplimiento por semana que Plan (mis sesiones y la sugerida,
 * con los vínculos manuales).
 */
export async function getWeekReports(today: string, weekStarts: readonly string[], ctx: Ctx = makeCtx()): Promise<Record<string, WeekReport>> {
  const current = mondayOf(today);
  const weeks = [...new Set(weekStarts.map(mondayOf))].filter((w) => w <= current).sort();
  if (!weeks.length) return {};
  const from = addDaysYmd(weeks[0], -7 * WEEK_PREV);
  const [core, goals, injuries] = await Promise.all([planCore(today, ctx, { weeksAhead: 1, from: weeks[0] }), ctx.goals(), ctx.injuries()]);
  const madrid = core.madrid;
  const allRuns = core.runs.map((r) => ({ r, date: madrid(r.startAt) })).filter((x) => x.date >= from && x.date <= today);
  const ids = allRuns.filter((x) => x.date >= weeks[0]).map((x) => x.r.id);
  const ratings = new Map(
    ids.length
      ? (await db().select({ id: s.runFeelings.runId, rating: s.runFeelings.rating }).from(s.runFeelings).where(inArray(s.runFeelings.runId, ids))).map((x) => [x.id, x.rating])
      : [],
  );
  const kmOf = (w: string) => allRuns.filter((x) => x.date >= w && x.date <= addDaysYmd(w, 6)).reduce((a, x) => a + (x.r.distanceM ?? 0), 0) / 1000;
  const weekRun = (x: (typeof allRuns)[number]): WeekReport["runs"][number] => ({
    id: x.r.id,
    date: x.date,
    dayLabel: fmtDay(x.date),
    distanceM: x.r.distanceM,
    durationS: x.r.durationS,
    type: x.r.type,
    typeLabel: x.r.type && isRunType(x.r.type) ? RUN_TYPE_META[x.r.type].label : "Sin tipo",
    load: x.r.trainingLoad,
    rating: ratings.get(x.r.id) ?? null,
    pace: x.r.distanceM && !x.r.isSpecial ? fmtPace(x.r.durationS / (x.r.distanceM / 1000)) : null,
  });

  // Previsto frente a realizado (por semana).
  const items: Record<string, WeekPlanItem[]> = Object.fromEntries(weeks.map((w) => [w, []]));
  const unplannedBy: Record<string, number> = {};
  const mineIn = (w: string) => (core.anchor ? core.mine : []).filter((m) => m.date >= w && m.date <= addDaysYmd(w, 6));
  if (core.anchor) {
    const { sessions, hidden, byStart } = core;
    const sugOf = (w: string) => {
      if (hidden[w]) return null;
      if (w === sessions[0].start) return { week: w, day: sessions[0].day, session: sessions[0].session };
      const r = byStart.get(w);
      return r ? { week: w, day: r.day, session: r.session as SessionKind } : null;
    };
    const sugManual = (w: string) => (byStart.get(w) ? manualOf(byStart.get(w)!) : undefined);
    const sugs = weeks.flatMap((w) => {
      const g = sugOf(w);
      return g ? [{ ...g, manual: sugManual(w) }] : [];
    });
    const { lite, assigned, mineRunIds } = planLinks(core, today, from, sugs);
    const sugHistory = lite.filter((r) => !mineRunIds.has(r.id)).map((r) => ({ date: r.date, type: r.type }));
    for (const w of weeks) {
      for (const m of mineIn(w)) {
        const l = assigned.get(m.id);
        items[w].push({ label: m.label, mine: true, day: m.date, status: mineStatus(m, l?.run, today), doneWhen: doneWhen(l), manual: m.link === "manual", runId: l?.run.id ?? null });
      }
      const g = sugs.find((x) => x.week === w);
      if (g) {
        const l = assigned.get(`sug:${w}`);
        const status =
          manualWeekStatus(g.session, g.manual, l?.run, () => weekStatus({ session: g.session, day: g.day, weekStart: w, today, runs: [] })) ??
          weekStatus({ session: g.session, day: g.day, weekStart: w, today, runs: sugHistory });
        items[w].push({
          label: SESSION_LABEL[g.session],
          mine: false,
          day: g.day,
          status,
          doneWhen: status === "cumplida" ? doneWhen(l) : null,
          manual: g.manual !== undefined && g.manual !== null,
          runId: l?.run.id ?? null,
        });
      }
    }
    const sugBy = new Map(sugs.filter((g) => g.manual === undefined).map((g) => [g.week, g.session]));
    const linkedIds = new Set([...mineRunIds, ...[...assigned].filter(([k, l]) => k.startsWith("sug:") && l.manual).map(([, l]) => l.run.id)]);
    for (const r of unplannedRuns(lite, linkedIds, sugBy, weekOf)) unplannedBy[weekOf(r.date)] = (unplannedBy[weekOf(r.date)] ?? 0) + 1;
  }

  const goalKm = goals.week.km && !goals.week.paused ? goals.week.km : null;
  const out: Record<string, WeekReport> = {};
  for (const w of weeks) {
    const end = addDaysYmd(w, 6);
    const runs = allRuns.filter((x) => x.date >= w && x.date <= end).sort((a, b) => a.r.startAt.getTime() - b.r.startAt.getTime()).map(weekRun);
    const injury = injuries.some((i) => i.startDate <= end && (i.endDate === null || i.endDate >= w) && i.startDate <= today);
    out[w] = {
      summary: summarizeWeek({
        start: w,
        today,
        runs,
        prevKm: Array.from({ length: WEEK_PREV }, (_, k) => kmOf(addDaysYmd(w, -7 * (k + 1)))),
        goalKm,
        plan: items[w],
        unplanned: unplannedBy[w] ?? 0,
        injury,
      }),
      plan: items[w].sort((a, b) => a.day.localeCompare(b.day)),
      runs,
    };
  }
  return out;
}
const WEEK_PREV = 8;

/** Fila compacta de una semana para el historial de Análisis y la tarjeta de Inicio. */
export interface WeekRow {
  start: string;
  end: string;
  inProgress: boolean;
  km: number;
  runs: number;
  planTotal: number;
  planDone: number;
  goalPct: number | null;
  /** frases (sin la del volumen, que ya va en cifras) */
  lines: WeekSummary["lines"];
}

/** Las `n` últimas semanas (la en curso incluida), de la más reciente a la más antigua. */
export async function getWeekHistory(today: string, n = 12, ctx: Ctx = makeCtx()): Promise<WeekRow[]> {
  const cur = mondayOf(today);
  const starts = Array.from({ length: n }, (_, k) => addDaysYmd(cur, -7 * k));
  const reports = await getWeekReports(today, starts, ctx);
  return starts.flatMap((w) => {
    const s = reports[w]?.summary;
    return s
      ? [{ start: s.start, end: s.end, inProgress: s.inProgress, km: s.km, runs: s.runs, planTotal: s.plan.total, planDone: s.plan.done, goalPct: s.goal ? s.goal.pct : null, lines: s.lines.slice(1) }]
      : [];
  });
}

// ─── Intensidad ──────────────────────────────────────────────────────────────

import { intensity, INTENSITY_VIEWS, type IntensityResult, type IntensityView } from "@/lib/analysis/intensity";

/** «Intensidad»: las tres vistas ya calculadas (el selector cambia al instante). */
export async function getIntensity(ctx: Ctx = makeCtx()): Promise<Record<IntensityView, IntensityResult>> {
  const runs = (await ctx.runs()).map((r) => ({ day: localDay(r.startAt), durationS: r.durationS, zoneSeconds: r.hrZoneSeconds }));
  const today = localDay(new Date());
  return Object.fromEntries(INTENSITY_VIEWS.map((v) => [v.key, intensity(runs, v.key, today)])) as Record<IntensityView, IntensityResult>;
}
