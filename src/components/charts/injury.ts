import { C } from "./EChart";

const LABEL = { show: true, position: "insideTop", formatter: "Lesión", color: C.axis, fontFamily: C.font, fontSize: 10 };

/**
 * Tramos de markArea con su propio estilo (se pueden mezclar con otras áreas de la misma serie).
 * La etiqueta «Lesión» solo va dentro si la banda es ancha (`labelIf`); si no, la explica la leyenda.
 */
export function injuryAreaItems<T extends number | string>(pairs: [T, T][], labelIf: (pair: [T, T]) => boolean = () => false) {
  return pairs.map((pair) => [
    { xAxis: pair[0], itemStyle: { color: "var(--ov-2)" }, label: labelIf(pair) ? LABEL : { show: false } },
    { xAxis: pair[1] },
  ]);
}

/** Bandas en un eje de tiempo: etiqueta dentro si ocupan al menos el 12 % del rango [min, max]. */
export function injuryMarkArea(pairs: [number, number][], min: number, max: number) {
  if (!pairs.length) return undefined;
  const span = Math.max(1, max - min);
  return { silent: true, data: injuryAreaItems(pairs, ([a, z]) => (z - a) / span >= 0.12) };
}
