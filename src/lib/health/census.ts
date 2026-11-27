/**
 * «Revisar datos de salud»: recuento de lo que trae el zip (sin guardar ninguna lectura).
 * Lógica pura, con pruebas.
 *
 * - HRV (SDNN), pulso en reposo, temperatura de muñeca y sueño: cuántas lecturas hay, de qué
 *   fuente (Watch, iPhone u otra), primera y última fecha, días con dato del Watch y días con
 *   dato en los 28 días que acaban en la fecha del export.
 * - Sueño: lecturas por fase (núcleo, profundo, REM, despierto, en cama…), solo del Watch.
 * - Pasos dentro de cada carrera (misma fuente y ventana que la carrera): cuántas carreras los
 *   tienen y cada cuánto llegan, para saber si sirven para un gráfico de cadencia.
 */
export type HealthKind = "hrv" | "resting" | "wristTemp" | "sleep";

const QT = "HKQuantityTypeIdentifier";
export const HEALTH_TARGETS: { kind: HealthKind; label: string; start: string }[] = [
  { kind: "hrv", label: "Variabilidad cardíaca (HRV, SDNN)", start: `<Record type="${QT}HeartRateVariabilitySDNN"` },
  { kind: "resting", label: "Pulso en reposo", start: `<Record type="${QT}RestingHeartRate"` },
  { kind: "sleep", label: "Sueño", start: `<Record type="HKCategoryTypeIdentifierSleepAnalysis"` },
  { kind: "wristTemp", label: "Temperatura de muñeca", start: `<Record type="${QT}AppleSleepingWristTemperature"` },
];
export const STEP_TARGET = `<Record type="${QT}StepCount"`;

/** Cortes para «cada cuánto llegan los pasos» (mediana por carrera, en segundos). */
export const STEP_GAP_BUCKETS = [10, 30, 60] as const;

export type SourceKind = "watch" | "phone" | "other";
export const sourceKind = (name: string | null | undefined): SourceKind =>
  /watch/i.test(name ?? "") ? "watch" : /iphone/i.test(name ?? "") ? "phone" : "other";

export interface KindTally {
  total: number;
  watch: number;
  phone: number;
  other: number;
  /** AAAA-MM-DD (Madrid) */
  first: string | null;
  last: string | null;
  /** días con lectura del Watch (como claves: rápido y se guarda en JSON) */
  watchDays: Record<string, 1>;
}

export interface Census {
  kinds: Record<HealthKind, KindTally>;
  /** fase → lecturas (Watch) */
  sleepStages: Record<string, number>;
  /** carrera → segundos desde el inicio de cada registro de pasos (Watch, dentro de la carrera) */
  steps: Record<string, number[]>;
}

const empty = (): KindTally => ({ total: 0, watch: 0, phone: 0, other: 0, first: null, last: null, watchDays: {} });
export const newCensus = (): Census => ({
  kinds: { hrv: empty(), resting: empty(), sleep: empty(), wristTemp: empty() },
  sleepStages: {},
  steps: {},
});

const MADRID = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
export const madridDay = (d: Date) => MADRID.format(d);

/** Suma una lectura. Para el sueño, el día es el del final (la mañana en que acaba). */
export function addReading(c: Census, kind: HealthKind, r: { sourceName: string | null; start: Date; end: Date | null; value?: string | null }): void {
  const t = c.kinds[kind];
  const day = madridDay(kind === "sleep" ? (r.end ?? r.start) : r.start);
  const src = sourceKind(r.sourceName);
  t.total++;
  t[src]++;
  if (!t.first || day < t.first) t.first = day;
  if (!t.last || day > t.last) t.last = day;
  if (src === "watch") {
    t.watchDays[day] = 1;
    if (kind === "sleep") {
      const stage = (r.value ?? "").replace("HKCategoryValueSleepAnalysis", "") || "Desconocida";
      c.sleepStages[stage] = (c.sleepStages[stage] ?? 0) + 1;
    }
  }
}

export function addStep(c: Census, runId: string, offsetS: number): void {
  (c.steps[runId] ??= []).push(offsetS);
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface CensusSummary {
  kinds: {
    kind: HealthKind;
    label: string;
    total: number;
    watch: number;
    phone: number;
    other: number;
    first: string | null;
    last: string | null;
    watchDays: number;
    /** días con dato del Watch en los 28 días que acaban en el export */
    last28: number;
  }[];
  sleepStages: { stage: string; label: string; n: number }[];
  /** días con HRV, reposo y sueño del Watch a la vez */
  allThreeDays: number;
  allThreeLast28: number;
  steps: {
    runsTotal: number;
    runsWithSteps: number;
    samples: number;
    /** mediana de la mediana por carrera del intervalo entre registros (s) */
    medianGapS: number | null;
    /** carreras por su intervalo típico: ≤10 s, ≤30 s, ≤60 s, > 60 s */
    byGap: { label: string; runs: number }[];
  };
}

const STAGE_LABEL: Record<string, string> = {
  InBed: "En cama",
  AsleepUnspecified: "Dormido (sin fase)",
  Asleep: "Dormido (sin fase)",
  AsleepCore: "Núcleo",
  AsleepDeep: "Profundo",
  AsleepREM: "REM",
  Awake: "Despierto",
};

/** Resumen para la pantalla. `endDay` = día del export (Madrid). */
export function summarizeCensus(c: Census, endDay: string, runsTotal: number): CensusSummary {
  const from28 = addDays(endDay, -27);
  const in28 = (d: string) => d >= from28 && d <= endDay;
  const kinds = HEALTH_TARGETS.map(({ kind, label }) => {
    const t = c.kinds[kind];
    return {
      kind,
      label,
      total: t.total,
      watch: t.watch,
      phone: t.phone,
      other: t.other,
      first: t.first,
      last: t.last,
      watchDays: Object.keys(t.watchDays).length,
      last28: Object.keys(t.watchDays).filter(in28).length,
    };
  });
  const sets = (["hrv", "resting", "sleep"] as const).map((k) => new Set(Object.keys(c.kinds[k].watchDays)));
  const all = [...sets[0]].filter((d) => sets[1].has(d) && sets[2].has(d));
  const perRun = Object.values(c.steps).map((ts) => {
    const s = [...ts].sort((a, b) => a - b);
    const gaps = s.slice(1).map((t, i) => t - s[i]);
    return median(gaps);
  });
  const withGap = perRun.filter((g): g is number => g !== null);
  const [b10, b30, b60] = STEP_GAP_BUCKETS;
  return {
    kinds,
    sleepStages: Object.entries(c.sleepStages)
      .map(([stage, n]) => ({ stage, label: STAGE_LABEL[stage] ?? stage, n }))
      .sort((a, b) => b.n - a.n),
    allThreeDays: all.length,
    allThreeLast28: all.filter(in28).length,
    steps: {
      runsTotal,
      runsWithSteps: Object.keys(c.steps).length,
      samples: Object.values(c.steps).reduce((a, ts) => a + ts.length, 0),
      medianGapS: median(withGap),
      byGap: [
        { label: `≤ ${b10} s`, runs: withGap.filter((g) => g <= b10).length },
        { label: `${b10 + 1}–${b30} s`, runs: withGap.filter((g) => g > b10 && g <= b30).length },
        { label: `${b30 + 1}–${b60} s`, runs: withGap.filter((g) => g > b30 && g <= b60).length },
        { label: `> ${b60} s`, runs: withGap.filter((g) => g > b60).length },
      ],
    },
  };
}
