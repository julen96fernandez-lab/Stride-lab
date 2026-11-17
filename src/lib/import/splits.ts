/** Parciales por kilómetro a partir de una distancia acumulada en el tiempo. */

export interface Series {
  t: number[]; // s desde el inicio, ordenado
  v: number[];
}

export interface Split {
  idx: number;
  distanceM: number;
  durationS: number;
  paceSPerKm: number | null;
  avgHr: number | null;
  avgPowerW: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
}

const MIN_LAST_SPLIT_M = 50;

/** Distancia acumulada a partir de muestras por intervalo (m recorridos al final de cada intervalo). */
export function cumulativeFromIntervals(s: Series): Series {
  const order = s.t.map((_, i) => i).sort((a, b) => s.t[a] - s.t[b]);
  const t: number[] = [0];
  const v: number[] = [0];
  let d = 0;
  for (const i of order) {
    d += s.v[i];
    t.push(s.t[i]);
    v.push(d);
  }
  return { t, v };
}

export function meanInRange(s: Series | undefined, t0: number, t1: number): number | null {
  if (!s || s.t.length === 0) return null;
  let lo = 0,
    hi = s.t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] < t0) lo = mid + 1;
    else hi = mid;
  }
  let sum = 0,
    n = 0;
  for (let i = lo; i < s.t.length && s.t[i] <= t1; i++) {
    sum += s.v[i];
    n++;
  }
  return n ? sum / n : null;
}

function gainLossInRange(ele: Series | undefined, t0: number, t1: number, threshold = 1) {
  if (!ele || ele.t.length === 0) return { gain: null, loss: null };
  let gain = 0,
    loss = 0,
    ref: number | null = null,
    any = false;
  for (let i = 0; i < ele.t.length; i++) {
    if (ele.t[i] < t0) {
      ref = ele.v[i];
      continue;
    }
    if (ele.t[i] > t1) break;
    any = true;
    if (ref === null) {
      ref = ele.v[i];
      continue;
    }
    const d = ele.v[i] - ref;
    if (d >= threshold) {
      gain += d;
      ref = ele.v[i];
    } else if (d <= -threshold) {
      loss -= d;
      ref = ele.v[i];
    }
  }
  return any ? { gain, loss } : { gain: null, loss: null };
}

export function computeSplits(
  dist: Series,
  opts: { hr?: Series; power?: Series; elevation?: Series } = {},
): Split[] {
  const { t, v } = dist;
  if (t.length < 2) return [];
  const total = v[v.length - 1];
  const bounds: number[] = [t[0]];
  let i = 1;
  for (let k = 1; k * 1000 <= total; k++) {
    const target = k * 1000;
    while (i < v.length && v[i] < target) i++;
    if (i >= v.length) break;
    const d0 = v[i - 1],
      d1 = v[i];
    const f = d1 > d0 ? (target - d0) / (d1 - d0) : 1;
    bounds.push(t[i - 1] + f * (t[i] - t[i - 1]));
  }
  const full = bounds.length - 1;
  const remaining = total - full * 1000;
  const lastT = t[t.length - 1];
  if (remaining >= MIN_LAST_SPLIT_M && lastT > bounds[bounds.length - 1]) bounds.push(lastT);

  const splits: Split[] = [];
  for (let k = 1; k < bounds.length; k++) {
    const t0 = bounds[k - 1],
      t1 = bounds[k];
    const distanceM = k <= full ? 1000 : remaining;
    const durationS = t1 - t0;
    const el = gainLossInRange(opts.elevation, t0, t1);
    splits.push({
      idx: k,
      distanceM,
      durationS,
      paceSPerKm: distanceM > 0 ? durationS / (distanceM / 1000) : null,
      avgHr: meanInRange(opts.hr, t0, t1),
      avgPowerW: meanInRange(opts.power, t0, t1),
      elevationGainM: el.gain,
      elevationLossM: el.loss,
    });
  }
  return splits;
}
