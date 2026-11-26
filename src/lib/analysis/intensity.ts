/**
 * «Intensidad» (Análisis): reparto del tiempo por zonas de pulso, agrupado en suave (Z1–Z2), medio
 * (Z3) y fuerte (Z4–Z5), por semana o por mes. Lógica pura, con pruebas.
 *
 * - Solo cuentan las carreras cuyo pulso cubre al menos el 80 % de la duración (las demás se
 *   cuentan aparte como «fuera por pulso insuficiente»).
 * - El reparto es por tiempo (segundos en cada zona), sumando todas las carreras válidas.
 * - La línea del 80 % suave es una guía habitual en corredores, neutra: no se juzga.
 * - Con menos de 5 carreras válidas en el periodo no se sacan conclusiones (no hay frase).
 */
import { MIN_HR_COVERAGE } from "./hr-zones";

export const INTENSITY_RULES = {
  coverage: MIN_HR_COVERAGE,
  minRuns: 5,
  /** guía habitual: ~80 % del tiempo suave */
  easyGuide: 0.8,
  weeks: 12,
  months: 12,
} as const;

export type IntensityView = "12s" | "12m" | "todo";
export const INTENSITY_VIEWS: { key: IntensityView; label: string }[] = [
  { key: "12s", label: "12 semanas" },
  { key: "12m", label: "12 meses" },
  { key: "todo", label: "Todo" },
];

export interface IntensityRun {
  /** día local (Madrid), días desde 1970 */
  day: number;
  durationS: number;
  /** segundos en Z1…Z5 */
  zoneSeconds: readonly number[] | null;
}

export interface IntensityBucket {
  /** AAAA-MM-DD (lunes) o AAAA-MM */
  key: string;
  label: string;
  easyS: number;
  midS: number;
  hardS: number;
  runs: number;
}

export interface IntensityResult {
  buckets: IntensityBucket[];
  easyS: number;
  midS: number;
  hardS: number;
  /** % del total (0–1); null sin tiempo */
  pct: { easy: number; mid: number; hard: number } | null;
  valid: number;
  excluded: number;
  /** «Tu reparto: …» (con al menos 5 válidas) */
  sentence: string | null;
}

const DAY = 86_400_000;
const ymd = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const monday = (d: number) => d - ((new Date(d * DAY).getUTCDay() + 6) % 7);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pctTxt = (x: number) => `${Math.round(x * 100)} %`;

/** ¿Pulso suficiente? (las muestras cubren al menos el 80 % de la carrera) */
export function coversEnough(r: { durationS: number; zoneSeconds: readonly number[] | null }): boolean {
  if (!r.zoneSeconds || r.durationS <= 0) return false;
  return r.zoneSeconds.reduce((a, b) => a + b, 0) / r.durationS >= INTENSITY_RULES.coverage;
}

/** Reparto de una vista: por semana (12 s) o por mes (12 m y todo). `today` en días locales. */
export function intensity(runs: readonly IntensityRun[], view: IntensityView, today: number): IntensityResult {
  const R = INTENSITY_RULES;
  // Cubos de la vista.
  const buckets: IntensityBucket[] = [];
  const monthKey = (d: number) => ymd(d).slice(0, 7);
  if (view === "12s") {
    const cur = monday(today);
    for (let k = R.weeks - 1; k >= 0; k--) {
      const m = cur - 7 * k;
      const s = ymd(m);
      buckets.push({ key: s, label: `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`, easyS: 0, midS: 0, hardS: 0, runs: 0 });
    }
  } else {
    const t = new Date(today * DAY);
    let first = view === "12m" ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - (R.months - 1), 1)) : null;
    if (!first) {
      const firstDay = runs.filter(coversEnough).reduce((m, r) => Math.min(m, r.day), Infinity);
      first = Number.isFinite(firstDay) ? new Date(Date.UTC(new Date(firstDay * DAY).getUTCFullYear(), new Date(firstDay * DAY).getUTCMonth(), 1)) : new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    }
    for (let d = new Date(first); d <= t; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const key = d.toISOString().slice(0, 7);
      const label = `${MONTHS[d.getUTCMonth()]}${d.getUTCMonth() === 0 || view === "todo" ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}`;
      buckets.push({ key, label, easyS: 0, midS: 0, hardS: 0, runs: 0 });
    }
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const keyOf = (d: number) => (view === "12s" ? ymd(monday(d)) : monthKey(d));
  const from = view === "12s" ? buckets[0].key : `${buckets[0].key}-01`;

  let valid = 0;
  let excluded = 0;
  for (const r of runs) {
    if (ymd(r.day) < from || r.day > today) continue;
    const b = byKey.get(keyOf(r.day));
    if (!b) continue;
    if (!coversEnough(r)) {
      excluded++;
      continue;
    }
    const z = r.zoneSeconds!;
    b.easyS += (z[0] ?? 0) + (z[1] ?? 0);
    b.midS += z[2] ?? 0;
    b.hardS += (z[3] ?? 0) + (z[4] ?? 0);
    b.runs++;
    valid++;
  }
  const easyS = buckets.reduce((a, b) => a + b.easyS, 0);
  const midS = buckets.reduce((a, b) => a + b.midS, 0);
  const hardS = buckets.reduce((a, b) => a + b.hardS, 0);
  const total = easyS + midS + hardS;
  const pct = total > 0 ? { easy: easyS / total, mid: midS / total, hard: hardS / total } : null;
  const sentence =
    pct && valid >= R.minRuns
      ? `Tu reparto: ${pctTxt(pct.easy)} suave, ${pctTxt(pct.mid)} medio y ${pctTxt(pct.hard)} fuerte (en ${valid} carreras con pulso suficiente).`
      : null;
  return { buckets, easyS, midS, hardS, pct, valid, excluded, sentence };
}
