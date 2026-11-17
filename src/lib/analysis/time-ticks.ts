/**
 * Marcas regulares para un eje de tiempo, con fechas en español: todas a la misma
 * distancia de calendario (cada N meses en el día 1, o cada N días) y como mucho `max`.
 */
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAY = 86_400_000;

export interface TimeTicks {
  values: number[];
  label: (v: number) => string;
}

export function timeTicks(min: number, max: number, maxTicks = 5): TimeTicks {
  const months = (max - min) / (30.44 * DAY);
  if (months < 2) {
    const step = [1, 2, 7, 14].find((s) => (max - min) / (s * DAY) <= maxTicks) ?? 14;
    const first = Math.ceil(min / DAY) * DAY;
    const values: number[] = [];
    for (let v = first; v <= max; v += step * DAY) values.push(v);
    return { values, label: (v) => `${new Date(v).getUTCDate()} ${MES[new Date(v).getUTCMonth()]}` };
  }
  const step = [1, 2, 3, 6, 12, 24, 36, 60].find((s) => months / s <= maxTicks) ?? 120;
  const d0 = new Date(min);
  const y = d0.getUTCFullYear();
  let m = d0.getUTCMonth();
  if (Date.UTC(y, m, 1) < min) m += 1; // primera marca: el día 1 siguiente
  // Alinear a múltiplos del paso (enero para años; ene/abr/jul/oct para trimestres…).
  const idx = y * 12 + m;
  let k = Math.ceil(idx / step) * step;
  const values: number[] = [];
  for (; ; k += step) {
    const v = Date.UTC(Math.floor(k / 12), k % 12, 1);
    if (v > max) break;
    values.push(v);
  }
  const multiYear = new Date(min).getUTCFullYear() !== new Date(max).getUTCFullYear();
  const label = (v: number) => {
    const d = new Date(v);
    if (step >= 12) return String(d.getUTCFullYear());
    return multiYear ? `${MES[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` : MES[d.getUTCMonth()];
  };
  return { values, label };
}
