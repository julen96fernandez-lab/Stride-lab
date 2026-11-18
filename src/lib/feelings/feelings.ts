/**
 * Sensaciones por carrera: valoración 1–5, nota libre (≤ 500 caracteres) y etiquetas.
 * Lógica pura, con pruebas. Se guardan en una tabla aparte (run_feelings) ligada a la carrera:
 * no se tocan al reprocesar ni al subir el zip.
 */
export const FEELING_TAGS = {
  piernas_pesadas: "Piernas pesadas",
  calor: "Calor",
  sueno_malo: "Sueño malo",
  molestia: "Molestia",
  buen_dia: "Buen día",
  viento: "Viento",
  estomago: "Estómago",
} as const;
export type FeelingTag = keyof typeof FEELING_TAGS;
export const TAG_KEYS = Object.keys(FEELING_TAGS) as FeelingTag[];

export const RATING_LABEL: Record<number, string> = { 1: "Fatal", 2: "Mal", 3: "Normal", 4: "Bien", 5: "Genial" };
export const NOTE_MAX = 500;

/** Color de cada valoración (de rojo a lima): el mismo en el detalle, Actividad y Análisis. */
export const RATING_COLOR: Record<number, string> = {
  1: "var(--load-high)",
  2: "var(--load-mod)",
  3: "var(--fg-2)",
  4: "var(--t-rodaje)",
  5: "var(--chart-line)",
};

export interface Feeling {
  rating: number | null;
  note: string | null;
  tags: FeelingTag[];
}

export const EMPTY_FEELING: Feeling = { rating: null, note: null, tags: [] };

/** Valida y normaliza lo que llega del formulario. Error en español si algo no vale. */
export function parseFeeling(raw: { rating?: unknown; note?: unknown; tags?: unknown }): { feeling: Feeling } | { error: string } {
  let rating: number | null = null;
  if (raw.rating !== null && raw.rating !== undefined && raw.rating !== "") {
    const n = Number(raw.rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) return { error: "La valoración va de 1 a 5." };
    rating = n;
  }
  let note: string | null = null;
  if (raw.note !== null && raw.note !== undefined) {
    const t = String(raw.note).replace(/\r\n/g, "\n").trim();
    if (t.length > NOTE_MAX) return { error: `La nota admite hasta ${NOTE_MAX} caracteres.` };
    note = t || null;
  }
  const list = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
  const bad = list.find((t) => !(t in FEELING_TAGS));
  if (bad) return { error: "Etiqueta no válida." };
  const tags = TAG_KEYS.filter((k) => list.includes(k)); // sin repetidas y en orden fijo
  return { feeling: { rating, note, tags } };
}

/** Sin valoración, nota ni etiquetas: no hay sensación (se borra). */
export const isEmptyFeeling = (f: Feeling) => f.rating === null && !f.note && f.tags.length === 0;
