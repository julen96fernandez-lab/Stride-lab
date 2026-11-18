/**
 * Medición de consultas por pantalla (diagnóstico de rendimiento). Lógica pura.
 * Cada consulta deja su inicio y fin; de ahí salen el nº de consultas, el tiempo en base de
 * datos y cuántas «rondas» van en serie (grupos de consultas que se solapan).
 */
export interface QuerySpan {
  start: number;
  end: number;
}

export interface TraceSummary {
  queries: number;
  /** suma de la duración de todas las consultas (ms) */
  dbMs: number;
  /** rondas en serie: consultas que no se solapan con la anterior abren ronda nueva */
  serialRounds: number;
  /** máximo de consultas a la vez */
  maxParallel: number;
}

export function summarizeTrace(spans: readonly QuerySpan[]): TraceSummary {
  const done = spans.filter((s) => s.end >= s.start).sort((a, b) => a.start - b.start);
  let rounds = 0;
  let roundEnd = -Infinity;
  for (const s of done) {
    if (s.start >= roundEnd) {
      rounds++;
      roundEnd = s.end;
    } else roundEnd = Math.max(roundEnd, s.end);
  }
  const events = done.flatMap((s) => [
    { t: s.start, d: 1 },
    { t: s.end, d: -1 },
  ]);
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0;
  let max = 0;
  for (const e of events) {
    cur += e.d;
    max = Math.max(max, cur);
  }
  return { queries: done.length, dbMs: Math.round(done.reduce((a, s) => a + (s.end - s.start), 0)), serialRounds: rounds, maxParallel: max };
}
