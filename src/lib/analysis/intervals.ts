/**
 * Series a partir de los pasos de intervalo del Apple Watch ("bloque.repetición.fase"):
 * calentamiento, repeticiones de trabajo, recuperaciones intercaladas y enfriamiento.
 *
 * Regla: en un bloque con repeticiones, la fase 0 es trabajo y la fase 1 recuperación (el orden
 * de los entrenamientos del reloj). Se comprueba con los datos: si el trabajo no es más rápido
 * que la recuperación, no se separa (se explica el motivo en vez de inventarlo).
 */
export interface StepTiming {
  key: string;
  startS: number;
  durationS: number;
}

export interface Series {
  t: readonly number[];
  v: readonly number[];
}

export type StepKind = "calentamiento" | "trabajo" | "recuperacion" | "enfriamiento" | "otro";

export interface IntervalRow {
  key: string;
  kind: StepKind;
  /** nº de repetición (trabajo y su recuperación comparten número); null fuera de las series */
  rep: number | null;
  t0: number;
  t1: number;
  durationS: number;
  distanceM: number | null;
  paceSPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** pulso al final del paso */
  hrEnd: number | null;
  /** solo recuperaciones: pulso al final del trabajo anterior − pulso al final de esta recuperación */
  hrDrop: number | null;
}

export interface IntervalSummary {
  reps: number;
  workPaceSPerKm: number | null;
  workDistanceM: number;
  workTimeS: number;
  /** % de caída de ritmo de la primera a la última repetición (positivo = más lenta al final) */
  paceDropPct: number | null;
  /** media de las bajadas de pulso en las recuperaciones (ppm) */
  avgHrDrop: number | null;
}

export type IntervalAnalysis = { ok: true; rows: IntervalRow[]; summary: IntervalSummary } | { ok: false; reason: string };

export function parseKey(key: string): { block: number; rep: number; phase: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(key);
  return m ? { block: Number(m[1]), rep: Number(m[2]), phase: Number(m[3]) } : null;
}

const lowerBound = (xs: readonly number[], x: number) => {
  let lo = 0,
    hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Distancia acumulada (m) a partir de muestras por intervalo, en el instante x (interpolada). */
export function cumulativeAt(dist: Series): (x: number) => number {
  const order = dist.t.map((_, i) => i).sort((a, b) => dist.t[a] - dist.t[b]);
  const t = [0];
  const d = [0];
  let acc = 0;
  for (const i of order) {
    acc += dist.v[i];
    t.push(dist.t[i]);
    d.push(acc);
  }
  return (x: number) => {
    const j = lowerBound(t, x);
    if (j <= 0) return d[0];
    if (j >= t.length) return d[d.length - 1];
    const f = (x - t[j - 1]) / (t[j] - t[j - 1] || 1);
    return d[j - 1] + f * (d[j] - d[j - 1]);
  };
}

/** Media y máximo del pulso dentro de [t0, t1]; pulso en t1 (muestra más cercana a ≤ 30 s). */
export function hrInRange(hr: Series | null | undefined, t0: number, t1: number) {
  if (!hr || !hr.t.length) return { avg: null, max: null, end: null };
  const i0 = lowerBound(hr.t, t0);
  const i1 = lowerBound(hr.t, t1 + 1e-9);
  const vals = hr.v.slice(i0, i1);
  let end: number | null = null;
  let best = Infinity;
  for (let i = Math.max(0, i1 - 3); i < Math.min(hr.t.length, i1 + 3); i++) {
    const d = Math.abs(hr.t[i] - t1);
    if (d <= 30 && d < best) {
      best = d;
      end = hr.v[i];
    }
  }
  return {
    avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    max: vals.length ? Math.max(...vals) : null,
    end,
  };
}

export function analyzeIntervals(
  steps: readonly StepTiming[] | null | undefined,
  distance: Series | null | undefined,
  hr: Series | null | undefined,
): IntervalAnalysis {
  if (!steps || steps.length === 0) {
    return {
      ok: false,
      reason: "La importación solo guardó los nombres de los pasos, no sus horas. Pulsa «Reprocesar» en Perfil → Importar datos para leerlas del zip.",
    };
  }
  const parsed = steps.map((s) => ({ ...s, p: parseKey(s.key) }));
  if (parsed.some((s) => !s.p)) return { ok: false, reason: "Los pasos del reloj no tienen el formato habitual (bloque.repetición.fase)." };

  // Bloques con repeticiones o con dos fases = series. El primer bloque simple antes es calentamiento;
  // el último bloque simple después, enfriamiento.
  const blocks = [...new Set(parsed.map((s) => s.p!.block))].sort((a, b) => a - b);
  const isSeriesBlock = (b: number) => {
    const st = parsed.filter((s) => s.p!.block === b);
    return new Set(st.map((s) => s.p!.rep)).size > 1 || new Set(st.map((s) => s.p!.phase)).size > 1;
  };
  const seriesBlocks = blocks.filter(isSeriesBlock);
  if (seriesBlocks.length === 0) return { ok: false, reason: "El entrenamiento no tiene bloques con repeticiones: no hay series que separar." };
  const firstSeries = seriesBlocks[0];
  const lastSeries = seriesBlocks[seriesBlocks.length - 1];

  const cum = distance && distance.t.length > 1 ? cumulativeAt(distance) : null;
  let repNo = 0;
  const rows: IntervalRow[] = parsed
    .sort((a, b) => a.startS - b.startS)
    .map((s) => {
      const { block, phase } = s.p!;
      let kind: StepKind;
      if (isSeriesBlock(block)) kind = phase === 0 ? "trabajo" : phase === 1 ? "recuperacion" : "otro";
      else if (block < firstSeries) kind = "calentamiento";
      else if (block > lastSeries) kind = "enfriamiento";
      else kind = "otro";
      if (kind === "trabajo") repNo++;
      const t0 = s.startS;
      const t1 = s.startS + s.durationS;
      const distanceM = cum ? cum(t1) - cum(t0) : null;
      const h = hrInRange(hr, t0, t1);
      return {
        key: s.key,
        kind,
        rep: kind === "trabajo" || kind === "recuperacion" ? repNo : null,
        t0,
        t1,
        durationS: s.durationS,
        distanceM: distanceM !== null && distanceM > 0 ? distanceM : null,
        paceSPerKm: distanceM !== null && distanceM >= 20 ? s.durationS / (distanceM / 1000) : null,
        avgHr: h.avg,
        maxHr: h.max,
        hrEnd: h.end,
        hrDrop: null,
      };
    });

  const work = rows.filter((r) => r.kind === "trabajo");
  const rec = rows.filter((r) => r.kind === "recuperacion");
  if (work.length < 2) return { ok: false, reason: "Solo hay una repetición de trabajo: no hay serie que analizar." };
  if (!cum) return { ok: false, reason: "Esta carrera no tiene muestras de distancia: no se puede calcular el ritmo de cada repetición." };

  // Comprobación con los datos: el trabajo tiene que ser más rápido que la recuperación.
  const avgPace = (rs: IntervalRow[]) => {
    const d = rs.reduce((a, r) => a + (r.distanceM ?? 0), 0);
    const t = rs.filter((r) => r.distanceM).reduce((a, r) => a + r.durationS, 0);
    return d > 0 ? t / (d / 1000) : null;
  };
  const wp = avgPace(work);
  const rp = avgPace(rec);
  if (wp === null) return { ok: false, reason: "No hay distancia suficiente en las repeticiones para calcular su ritmo." };
  if (rp !== null && wp >= rp) {
    return {
      ok: false,
      reason: "Los pasos no permiten distinguir trabajo y recuperación: las fases marcadas como trabajo no son más rápidas que las de recuperación.",
    };
  }

  // Recuperación de pulso: final del trabajo anterior → final de la recuperación.
  for (const r of rec) {
    const prevWork = work.filter((w) => w.t1 <= r.t0 + 1).at(-1);
    if (prevWork?.hrEnd != null && r.hrEnd != null) r.hrDrop = prevWork.hrEnd - r.hrEnd;
  }
  const drops = rec.map((r) => r.hrDrop).filter((d): d is number => d !== null);
  const firstP = work[0].paceSPerKm;
  const lastP = work[work.length - 1].paceSPerKm;

  return {
    ok: true,
    rows,
    summary: {
      reps: work.length,
      workPaceSPerKm: wp,
      workDistanceM: work.reduce((a, r) => a + (r.distanceM ?? 0), 0),
      workTimeS: work.reduce((a, r) => a + r.durationS, 0),
      paceDropPct: firstP !== null && lastP !== null ? ((lastP - firstP) / firstP) * 100 : null,
      avgHrDrop: drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null,
    },
  };
}
