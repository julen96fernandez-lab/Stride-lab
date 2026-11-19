import "server-only";
import { EFFORT_DISTANCES, improvementPct, recordProgression, type EffortKey } from "@/lib/analysis/best-efforts";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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
import { getShiftAnchor } from "@/lib/plan/shifts-db";
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
  return {
    run,
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
  const [runs, goals, injuries, records, efficiency] = await Promise.all([
    ctx.runs(),
    ctx.goals(),
    ctx.injuries(),
    getRecords(ctx),
    getEfficiency("rodaje", ctx),
  ]);
  const { recommendToday, weekDays } = await import("@/lib/analysis/home");
  const today = new Date(localDay(now) * 86_400_000).toISOString().slice(0, 10);
  const openInjury = injuries.find((i) => i.startDate <= today && (i.endDate === null || i.endDate >= today)) ?? null;
  const recent = runs.filter((r) => r.startAt.getTime() >= now.getTime() - 60 * 86_400_000);
  const fitness = buildFitnessView(fitnessRuns(runs), now, !!openInjury);
  const cur = fitness.current;
  const advice = recommendToday({
    runs: recent,
    openInjury: !!openInjury,
    now,
    fitness: cur ? { ratio: cur.ratio, form: cur.form, chronic: cur.chronic, enough: !cur.warmup } : null,
  });

  const week = buildPeriods(runs, "week", 1, now)[0];
  const month = buildPeriods(runs, "month", 1, now)[0];
  const monthCmp = comparePeriodToDate(runs.filter((r) => !r.inInjury), "month", now);
  return {
    openInjury: openInjury ? { startDate: openInjury.startDate, note: openInjury.note } : null,
    advice,
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

import { dayNum, shiftWeek, shiftWeeks, ymdOf, type ShiftWeek } from "@/lib/plan/shifts";
import { pickSources, predictAt, predictionHistory } from "@/lib/plan/predict";
import { SESSION_LABEL, demandingOf, fmtDay, planWeeks, type SessionKind } from "@/lib/plan/weekly";
import { rescheduleDay, weekStatus } from "@/lib/plan/compliance";
import { freezeWeek, getStoredWeeks, listMine, type MineRow } from "@/lib/plan/plan-db";
import { MINE_LABEL, mineDetail, weekOf, type MineKind } from "@/lib/plan/mine";
import { linkMine, mineStatus, unplannedRuns, type MineStatus } from "@/lib/plan/linking";
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
  /** ritmo previsto si puse distancia y duración */
  plannedPace: string | null;
  plannedKm: string | null;
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
  status: "pendiente",
  done: null,
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
});
/** Por qué no se muestra la sugerencia de una semana. */
export type Hidden = { by: "dismissed" } | { by: "replaced"; id: string };

function mineExigentes(mine: readonly MineView[]): Exigente[] {
  return mine.flatMap((m) => {
    const k = demandingOf(m.kind);
    return k ? [{ date: m.date, kind: k, what: MINE_WHAT[m.kind], id: m.id }] : [];
  });
}

/** Mis sesiones de un día (para Inicio), con su estado (misma vinculación ±1 día que en Plan). */
export async function getMineOn(day: string, ctx: Ctx = makeCtx()): Promise<(MineView & { distanceM: number | null; durationS: number | null })[]> {
  const d = dayNum(day)!;
  const [rows, runs] = await Promise.all([listMine(db(), ymdOf(d - 2), ymdOf(d + 2)), ctx.runs()]);
  if (!rows.some((m) => m.date === day)) return [];
  const madrid = (x: Date) => new Date(localDay(x) * 86_400_000).toISOString().slice(0, 10);
  const lite = runs
    .map((r) => ({ id: r.id, date: madrid(r.startAt), at: r.startAt.getTime(), type: r.type }))
    .filter((r) => r.date >= ymdOf(d - 3) && r.date <= day);
  const links = linkMine(rows, lite);
  return rows
    .filter((m) => m.date === day)
    .map((m) => ({ ...mineView(m), distanceM: m.distanceM, durationS: m.durationS, status: mineStatus(m, links.get(m.id), day) }));
}

/** Ciclo de turnos: semanas desde la actual (incluida) y la anterior, para Plan. */
export async function getPlan(today: string, ctx: Ctx = makeCtx()) {
  const [anchor, predictions, runs, fitness, raceRows] = await Promise.all([ctx.shiftAnchor(), getPredictions(ctx), ctx.runs(), getFitness(ctx), ctx.races()]);
  const races = await withRaceResults(raceViews(raceRows, today, predictions), runs);
  const weeks: ShiftWeek[] = anchor ? shiftWeeks(anchor, today, 10) : [];
  const raceList = raceRows.map((r) => ({ name: r.name, date: r.date }));
  if (!anchor || !weeks.length) {
    const mine = (await listMine(db(), today, ymdOf(dayNum(today)! + 365))).map(mineView);
    const warnCtx: WarnCtx = { anchor: null, races: raceList, exigentes: mineExigentes(mine) };
    for (const m of mine) m.warnings = mineWarnings(m, warnCtx);
    return { anchor, today, weeks, sessions: [], current: null, past: [], predictions, races, mine, hidden: {} as Record<string, Hidden>, warnCtx, unplanned: {} as Record<string, RunBrief[]> };
  }

  const madrid = (d: Date) => new Date(localDay(d) * 86_400_000).toISOString().slice(0, 10);
  const history = runs.map((r) => ({ date: madrid(r.startAt), type: r.type }));
  const cur = fitness.current;
  const pastStart = ymdOf(weeks[0].startDay - 28);
  const [stored, mineRows] = await Promise.all([
    getStoredWeeks(db(), pastStart, weeks[weeks.length - 1].start),
    listMine(db(), pastStart, ymdOf(dayNum(today)! + 365)),
  ]);
  const byStart = new Map(stored.map((r) => [r.weekStart, r]));
  const mine = mineRows.map(mineView);
  // Sugerencias que no se muestran: quitadas por mí o sustituidas por una sesión mía.
  const hidden: Record<string, Hidden> = {};
  for (const r of stored) if (r.dismissed) hidden[r.weekStart] = { by: "dismissed" };
  for (const m of mine) if (m.replacesWeek && !hidden[m.replacesWeek]) hidden[m.replacesWeek] = { by: "replaced", id: m.id };
  const fixed = Object.fromEntries(
    stored.filter((r) => !r.dismissed).map((r) => [r.weekStart, { session: r.session as SessionKind, day: r.day, when: r.whenText, reason: r.reason, downgraded: r.downgraded }]),
  );
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
  });
  // Una exigente mía ocupa el sitio de la sugerencia de su semana.
  for (const w of sessions) if (w.occupiedBy && !hidden[w.start]) hidden[w.start] = { by: "replaced", id: w.occupiedBy };

  // Avisos de mis sesiones frente a las reglas (otras exigentes: mías, sugeridas visibles y corridas).
  const exigentes: Exigente[] = [
    ...mineExigentes(mine),
    ...sessions.flatMap((w) => {
      const k = demandingOf(w.session);
      return k && !hidden[w.start] && w.day >= today ? [{ date: w.day, kind: k, what: SUGG_WHAT[k] }] : [];
    }),
    ...history.flatMap((r) => {
      const k = demandingOf(r.type);
      return k && r.date >= pastStart && r.date <= today ? [{ date: r.date, kind: k, what: RUN_WHAT[k] }] : [];
    }),
  ];
  const warnCtx: WarnCtx = { anchor, races: raceList, exigentes };
  for (const m of mine) m.warnings = mineWarnings(m, warnCtx);

  // La semana en curso se congela la primera vez que se ve: ya no cambia al recalcular.
  const now = sessions[0];
  if (!byStart.has(now.start)) await freezeWeek(db(), now);
  const nowRow = byStart.get(now.start);
  const status = weekStatus({ session: now.session, day: now.day, weekStart: now.start, today, runs: history });
  const latest = now.race ? ymdOf(dayNum(now.race.date)! - 2) : null;
  const newDay = status === "dia_pasado" ? rescheduleDay({ anchor, kind: now.kind, session: now.session, weekStart: now.start, today, latest }) : null;
  const current = { ...now, status, rescheduledFrom: nowRow?.rescheduledFrom ?? null, canReschedule: newDay !== null && newDay !== now.day, rescheduleTo: newDay, hidden: hidden[now.start] ?? null };

  // Las 4 semanas anteriores, con la sugerencia guardada (si la hubo) y su resultado.
  const past = [1, 2, 3, 4].map((k) => {
    const w = shiftWeek(anchor, ymdOf(weeks[0].startDay - 7 * k));
    const r = byStart.get(w.start);
    const session = r ? (r.session as SessionKind) : null;
    return {
      start: w.start,
      end: w.end,
      kind: w.kind,
      sug:
        r && session
          ? { session, label: SESSION_LABEL[session], day: r.day, dayLabel: fmtDay(r.day), status: weekStatus({ session, day: r.day, weekStart: r.weekStart, today, runs: history }) }
          : null,
      hidden: hidden[w.start] ?? null,
    };
  });

  // Prevista frente a realizada: mis sesiones con la carrera del mismo día o ±1; el resto, no previstas.
  const lite = runs
    .map((r) => ({ id: r.id, date: madrid(r.startAt), at: r.startAt.getTime(), type: r.type, distanceM: r.distanceM, durationS: r.durationS }))
    .filter((r) => r.date >= pastStart && r.date <= today);
  const brief = (r: (typeof lite)[number]): RunBrief => ({
    id: r.id,
    date: r.date,
    dayLabel: fmtDay(r.date),
    typeLabel: r.type && isRunType(r.type) ? RUN_TYPE_META[r.type].label : "Sin tipo",
    km: r.distanceM ? (r.distanceM / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : null,
    pace: r.distanceM && r.durationS ? fmtPace(r.durationS / (r.distanceM / 1000)) : null,
  });
  const links = linkMine(mine, lite);
  for (const m of mine) {
    const run = links.get(m.id);
    m.status = mineStatus(m, run, today);
    m.done = run ? brief(run) : null;
  }
  const sugBy = new Map<string, SessionKind>();
  for (const w of sessions) if (!hidden[w.start]) sugBy.set(w.start, w.session);
  for (const w of past) if (w.sug && !w.hidden) sugBy.set(w.start, w.sug.session);
  const unplanned: Record<string, RunBrief[]> = {};
  for (const r of unplannedRuns(lite, new Set([...links.values()].map((x) => x.id)), sugBy, weekOf)) (unplanned[weekOf(r.date)] ??= []).push(brief(r));

  return { anchor, today, weeks, sessions, current, past, predictions, races, mine, hidden, warnCtx, unplanned };
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
