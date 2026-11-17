import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema as s } from "./client";
import { decodePolyline } from "@/lib/import/gpx";
import { paceAtHrByYear, type YearPace } from "@/lib/analysis/pace-at-hr";
import { durabilityFromSeries, durabilityFromSplits, type Durability } from "@/lib/analysis/durability";
import type { SeriesMetric } from "./schema";

const TZ = "Europe/Madrid";
const valid = eq(s.runs.status, "valid");

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
  };
}

export async function getHome() {
  const d = db();
  const [last28Rows, monthsRows, vo2Rows, lastRuns, totals] = await Promise.all([
    d.execute(sql`
      SELECT count(*)::int AS runs,
             sum(distance_m) AS dist,
             sum(duration_s) AS dur,
             sum(duration_s) FILTER (WHERE NOT is_special AND distance_m > 0) AS dur_ns,
             sum(distance_m) FILTER (WHERE NOT is_special AND distance_m > 0) AS dist_ns,
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
      .where(valid)
      .orderBy(desc(s.runs.startAt))
      .limit(1),
    d.execute(sql`SELECT count(*)::int AS n FROM runs WHERE status = 'valid'`),
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
  const lastRun: RunListItem | null = lr ? { ...lr, route: routeShape(lr.polyline) } : null;
  return { last28, months, vo2, lastRun, totalRuns: (totals.rows[0] as { n: number }).n };
}

// ─── Actividad ───────────────────────────────────────────────────────────────

export async function listRuns() {
  const d = db();
  const [rows, hidden] = await Promise.all([
    d
      .select(listColumns())
      .from(s.runs)
      .leftJoin(s.runRoutes, eq(s.runRoutes.runId, s.runs.id))
      .where(valid)
      .orderBy(desc(s.runs.startAt)),
    d.execute(sql`SELECT status, count(*)::int AS n FROM runs WHERE status <> 'valid' GROUP BY status`),
  ]);
  const items: RunListItem[] = rows.map((r) => ({ ...r, route: routeShape(r.polyline, 40) }));
  const h = Object.fromEntries((hidden.rows as { status: string; n: number }[]).map((x) => [x.status, x.n]));
  return { items, hiddenDuplicates: h.duplicate ?? 0, hiddenInvalid: h.invalid ?? 0 };
}

// ─── Detalle ─────────────────────────────────────────────────────────────────

export async function getRun(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const d = db();
  const runRows = await d.select().from(s.runs).where(eq(s.runs.id, id)).limit(1);
  const run = runRows[0];
  if (!run) return null;
  const [routeRows, splits, seriesRows, neighbours] = await Promise.all([
    d.select().from(s.runRoutes).where(eq(s.runRoutes.runId, id)).limit(1),
    d.select().from(s.runSplits).where(eq(s.runSplits.runId, id)).orderBy(asc(s.runSplits.idx)),
    d.select().from(s.runSeries).where(eq(s.runSeries.runId, id)),
    d.execute(sql`
      SELECT
        (SELECT id FROM runs WHERE status='valid' AND start_at < ${run.startAt} ORDER BY start_at DESC LIMIT 1) AS prev,
        (SELECT id FROM runs WHERE status='valid' AND start_at > ${run.startAt} ORDER BY start_at ASC LIMIT 1) AS next`),
  ]);
  const series = Object.fromEntries(seriesRows.map((r) => [r.metric, { t: r.t, v: r.v }])) as Partial<
    Record<SeriesMetric, { t: number[]; v: number[] }>
  >;
  let durability: Durability | null = null;
  if (series.distance) durability = durabilityFromSeries(series.distance, series.hr);
  if (!durability && splits.length) durability = durabilityFromSplits(splits, series.hr);
  const route = routeRows[0] ?? null;
  const nb = neighbours.rows[0] as { prev: string | null; next: string | null };
  return {
    run,
    route: route
      ? { points: decodePolyline(route.polyline ?? ""), bbox: [route.minLon, route.minLat, route.maxLon, route.maxLat] as const, shape: routeShape(route.polyline, 400) }
      : null,
    splits,
    hr: series.hr ?? null,
    power: series.power ?? null,
    durability,
    prevId: nb.prev,
    nextId: nb.next,
  };
}

// ─── Análisis ────────────────────────────────────────────────────────────────

export async function getAnalysis(band: [number, number]) {
  const d = db();
  const [vo2Rows, runRows] = await Promise.all([
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
      })
      .from(s.runs)
      .where(and(valid)),
  ]);
  const vo2 = (vo2Rows.rows as { day: string; v: string }[]).map((r) => ({ day: r.day, value: Number(r.v) }));
  const thisYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: TZ }).format(new Date()));
  const firstYear = runRows.length ? Math.min(...runRows.map((r) => Number(r.year))) : thisYear;

  const kmByYear: { year: number; km: number; runs: number }[] = [];
  for (let y = firstYear; y <= thisYear; y++) {
    const ys = runRows.filter((r) => Number(r.year) === y);
    kmByYear.push({ year: y, km: ys.reduce((a, r) => a + (r.distanceM ?? 0), 0) / 1000, runs: ys.length });
  }
  const paceAtHr: YearPace[] = paceAtHrByYear(
    runRows.map((r) => ({ ...r, year: Number(r.year) })),
    band,
    firstYear,
    thisYear,
  );
  const longest = runRows.reduce<number | null>((m, r) => (r.distanceM !== null && (m === null || r.distanceM > m) ? r.distanceM : m), null);
  const hrYears = runRows.filter((r) => r.avgHr !== null).map((r) => Number(r.year));
  const firstHrYear = hrYears.length ? Math.min(...hrYears) : null;
  return { vo2, kmByYear, paceAtHr, totalRuns: runRows.length, longestM: longest, firstHrYear };
}
