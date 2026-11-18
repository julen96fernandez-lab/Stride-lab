/**
 * Análisis de sensaciones. Lógica pura, con pruebas. Sin causas: solo qué etiquetas «suelen
 * aparecer junto a» las carreras peores (1–2) y mejores (4–5), y solo con datos suficientes.
 */
import { TAG_KEYS, type FeelingTag } from "./feelings";

export const MIN_RATED = 8;
/** Una etiqueta se menciona si aparece al menos estas veces en el grupo. */
export const MIN_TAG_COUNT = 2;

export interface FeelingRow {
  /** AAAA-MM-DD (Madrid) */
  date: string;
  rating: number | null;
  tags: FeelingTag[];
}

export interface TagLink {
  tag: FeelingTag;
  count: number;
  of: number;
  /** cuántas veces aparece en el otro grupo (para comparar) */
  otherCount: number;
  otherOf: number;
}

export interface FeelingStats {
  months: { month: string; avg: number | null; n: number }[];
  rated: number;
  withAny: number;
  enough: boolean;
  worst: TagLink[];
  best: TagLink[];
  worstN: number;
  bestN: number;
}

export function feelingStats(rows: readonly FeelingRow[], today: string, months = 12): FeelingStats {
  const [y, m] = today.split("-").map(Number);
  const list: FeelingStats["months"] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const r = rows.filter((x) => x.rating !== null && x.date.startsWith(key)).map((x) => x.rating!);
    list.push({ month: key, avg: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null, n: r.length });
  }
  const rated = rows.filter((r) => r.rating !== null);
  const enough = rated.length >= MIN_RATED;
  const worst = rated.filter((r) => r.rating! <= 2);
  const best = rated.filter((r) => r.rating! >= 4);
  const links = (group: typeof rated, other: typeof rated): TagLink[] =>
    !enough || group.length < MIN_TAG_COUNT
      ? []
      : TAG_KEYS.map((tag) => ({
          tag,
          count: group.filter((r) => r.tags.includes(tag)).length,
          of: group.length,
          otherCount: other.filter((r) => r.tags.includes(tag)).length,
          otherOf: other.length,
        }))
          .filter((l) => l.count >= MIN_TAG_COUNT)
          .sort((a, b) => b.count / b.of - a.count / a.of || b.count - a.count);
  return {
    months: list,
    rated: rated.length,
    withAny: rows.length,
    enough,
    worst: links(worst, best),
    best: links(best, worst),
    worstN: worst.length,
    bestN: best.length,
  };
}
