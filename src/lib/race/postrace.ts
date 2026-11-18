/**
 * Después de la carrera: parciales reales frente al plan. Lógica pura, con pruebas.
 * Solo hechos (cuánto y dónde), nunca causas.
 */
import { fmtTime } from "./race";
import type { PaceRow } from "./pacing";

export interface ActualSplit {
  idx: number;
  distanceM: number;
  durationS: number;
}

export interface KmCompare {
  km: number;
  planS: number;
  realS: number | null;
  /** real − plan (positivo = más lento) */
  diffS: number | null;
  /** acumulado real − acumulado plan (positivo = atrasado, negativo = adelantado) */
  cumDiffS: number | null;
}

export interface PostRace {
  rows: KmCompare[];
  totalRealS: number;
  totalPlanS: number;
  halvesPlan: [number, number];
  halvesReal: [number, number] | null;
  summary: string[];
}

const signed = (s: number) => `${s > 0 ? "+" : s < 0 ? "−" : ""}${fmtTime(Math.abs(s))}`;

/** Tiempo de cada mitad (por distancia) a partir de tramos consecutivos. */
function halvesOf(parts: readonly { lengthM: number; s: number }[], distanceM: number): [number, number] {
  let first = 0;
  let pos = 0;
  let total = 0;
  for (const p of parts) {
    const end = pos + p.lengthM;
    const inFirst = Math.max(0, Math.min(end, distanceM / 2) - pos);
    first += p.lengthM > 0 ? (p.s * inFirst) / p.lengthM : 0;
    total += p.s;
    pos = end;
  }
  return [first, total - first];
}

/** Tramo seguido (≥ 1 km) con la mayor suma de diferencias del signo pedido. */
function worstStretch(rows: readonly KmCompare[], sign: 1 | -1): { from: number; to: number; s: number } | null {
  let best: { from: number; to: number; s: number } | null = null;
  let curS = 0;
  let curFrom = 0;
  for (const r of rows) {
    if (r.diffS === null) continue;
    const v = sign * r.diffS;
    if (curS <= 0) {
      curS = v;
      curFrom = r.km;
    } else curS += v;
    if (curS > 0 && (!best || curS > best.s)) best = { from: curFrom, to: r.km, s: curS };
  }
  return best && best.s >= 5 ? best : null;
}

export function compareRace(plan: readonly PaceRow[], actual: readonly ActualSplit[], o: { distanceM: number; realTotalS: number }): PostRace {
  const byIdx = new Map(actual.map((a) => [a.idx, a]));
  let cumReal = 0;
  let realOk = true;
  const rows: KmCompare[] = plan.map((p) => {
    const a = byIdx.get(p.km);
    // El último tramo del plan puede ser parcial: el real se escala a esa longitud.
    const realS = a && a.distanceM > 0 ? (a.durationS * p.lengthM) / Math.min(a.distanceM, Math.max(p.lengthM, a.distanceM)) : null;
    if (realS === null) realOk = false;
    if (realS !== null && realOk) cumReal += realS;
    return {
      km: p.km,
      planS: p.splitS,
      realS: realS === null ? null : Math.round(realS),
      diffS: realS === null ? null : Math.round(realS - p.splitS),
      cumDiffS: realS === null || !realOk ? null : Math.round(cumReal - p.cumS),
    };
  });
  const totalPlanS = plan.at(-1)?.cumS ?? 0;
  const halvesPlan = halvesOf(plan.map((p) => ({ lengthM: p.lengthM, s: p.splitS })), o.distanceM);
  const halvesReal = rows.every((r) => r.realS !== null) ? halvesOf(rows.map((r, i) => ({ lengthM: plan[i].lengthM, s: r.realS! })), o.distanceM) : null;

  const summary: string[] = [];
  const diff = Math.round(o.realTotalS - totalPlanS);
  summary.push(
    Math.abs(diff) < 5
      ? `Terminaste en ${fmtTime(o.realTotalS)}: prácticamente el objetivo (${fmtTime(totalPlanS)}).`
      : `Terminaste en ${fmtTime(o.realTotalS)}: ${fmtTime(Math.abs(diff))} ${diff < 0 ? "más rápido" : "más lento"} que el objetivo (${fmtTime(totalPlanS)}).`,
  );
  const withCum = rows.filter((r) => r.cumDiffS !== null);
  if (withCum.length) {
    const ahead = withCum.reduce((m, r) => (r.cumDiffS! < m.cumDiffS! ? r : m));
    const behind = withCum.reduce((m, r) => (r.cumDiffS! > m.cumDiffS! ? r : m));
    if (ahead.cumDiffS! <= -5) summary.push(`Donde más adelantado fuiste: km ${ahead.km}, ${fmtTime(-ahead.cumDiffS!)} por delante del plan.`);
    if (behind.cumDiffS! >= 5) summary.push(`Donde más atrasado fuiste: km ${behind.km}, ${fmtTime(behind.cumDiffS!)} por detrás del plan.`);
  }
  const lost = worstStretch(rows, 1);
  const gained = worstStretch(rows, -1);
  const span = (x: { from: number; to: number }) => (x.from === x.to ? `el km ${x.from}` : `los km ${x.from}–${x.to}`);
  if (lost) summary.push(`Más tiempo perdido frente al plan, seguido: ${span(lost)} (${signed(lost.s)}).`);
  if (gained) summary.push(`Más tiempo ganado frente al plan, seguido: ${span(gained)} (${signed(-gained.s)}).`);
  if (halvesReal) {
    const [a, b] = halvesReal;
    summary.push(
      `Primera mitad ${fmtTime(a)} (plan ${fmtTime(halvesPlan[0])}); segunda ${fmtTime(b)} (plan ${fmtTime(halvesPlan[1])}): ${
        Math.abs(b - a) < 3 ? "mitades iguales" : b < a ? "segunda mitad más rápida" : "segunda mitad más lenta"
      }.`,
    );
  }
  if (rows.some((r) => r.realS === null)) summary.push("Faltan parciales de algunos km: la comparación se corta donde acaban los datos.");
  return { rows, totalRealS: o.realTotalS, totalPlanS, halvesPlan, halvesReal, summary };
}
