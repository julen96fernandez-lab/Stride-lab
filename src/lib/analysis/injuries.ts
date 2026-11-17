/**
 * Periodos de lesión: cálculos puros para marcar bandas en los gráficos. Fechas AAAA-MM-DD
 * en hora de Madrid; sin fecha de fin = el periodo sigue abierto (hasta hoy).
 */
export interface InjuryBand {
  startDate: string;
  endDate: string | null;
}

const DAY = 86_400_000;
const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);

/** ¿El día cae dentro de algún periodo? */
export function isInjuryDay(ymd: string, bands: InjuryBand[]): boolean {
  return bands.some((b) => ymd >= b.startDate && (b.endDate === null || ymd <= b.endDate));
}

/**
 * Columnas (índices) de periodos consecutivos que se solapan con una lesión, agrupadas en
 * tramos [primero, último]. `starts` = inicio de cada periodo en orden; el último llega a hoy.
 */
export function periodInjuryRanges(starts: string[], bands: InjuryBand[], today: string): [number, number][] {
  const hit = starts.map((s, i) => {
    const endExcl = starts[i + 1] ?? "9999-12-31";
    return bands.some((b) => b.startDate < endExcl && b.startDate <= today && (b.endDate ?? today) >= s);
  });
  const out: [number, number][] = [];
  hit.forEach((h, i) => {
    if (!h) return;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  });
  return out;
}

/** Bandas en ms (eje de tiempo), recortadas a [minMs, maxMs]. Un periodo abierto llega a `todayMs`. */
export function bandsToMs(bands: InjuryBand[], minMs: number, maxMs: number, todayMs: number): [number, number][] {
  return bands
    .map((b): [number, number] => [dayMs(b.startDate), b.endDate ? dayMs(b.endDate) + DAY : todayMs])
    .map(([a, z]): [number, number] => [Math.max(a, minMs), Math.min(z, maxMs)])
    .filter(([a, z]) => z > a);
}

/** Bandas del año `year` como días del año [inicio, fin], recortadas hasta `untilDoy`. */
export function bandsInYear(bands: InjuryBand[], year: number, untilDoy: number): [number, number][] {
  const jan1 = Date.UTC(year, 0, 1);
  return bands
    .map((b): [number, number] => [
      Math.round((dayMs(b.startDate) - jan1) / DAY),
      b.endDate ? Math.round((dayMs(b.endDate) - jan1) / DAY) : untilDoy,
    ])
    .map(([a, z]): [number, number] => [Math.max(a, 0), Math.min(z, untilDoy)])
    .filter(([a, z]) => z >= a);
}
