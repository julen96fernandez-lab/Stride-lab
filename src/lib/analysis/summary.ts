/**
 * «Resumen» del detalle de una carrera: de 3 a 5 frases cortas generadas con reglas (sin IA) a
 * partir de los datos reales. Lógica pura, con pruebas.
 *
 * - Solo se afirma lo que los datos permiten: sin pulso fiable (muestras que cubren < 80 % de la
 *   carrera) no se dice nada del pulso ni de las zonas; sin mitades, nada de mitades; con menos de
 *   3 sesiones parecidas, no se compara.
 * - Nada de causas: «coincidió con», «suele pasar cuando», nunca «por culpa de».
 * - Cada frase lleva un tono: «good» (bueno), «watch» (merece atención) o «neutral».
 * - Todos los umbrales están en SUMMARY_RULES.
 */
import { MIN_HR_COVERAGE } from "./hr-zones";

export const SUMMARY_RULES = {
  /** pulso fiable: las muestras cubren al menos esta parte de la carrera */
  hrCoverage: MIN_HR_COVERAGE,
  /** ¿encaja el pulso con el tipo? (zonas 1…5 → índices 0…4) */
  zonesFit: {
    easy: { types: ["rodaje", "recuperacion", "tirada_larga"], zones: [0, 1], min: 0.7, name: "Z1–Z2" },
    tempo: { types: ["tempo"], zones: [2, 3], min: 0.4, name: "Z3–Z4" },
    series: { types: ["series"], zones: [3, 4], min: 0.15, name: "Z4–Z5" },
  },
  /** sesiones parecidas: mismo tipo, distancia ±20 %, 12 meses anteriores, las 5 últimas, mínimo 3 */
  similar: { distPct: 0.2, days: 365, take: 5, min: 3 },
  /** ritmo frente a las parecidas: se menciona a partir de 5 s/km */
  paceDiffS: 5,
  /** carga frente a las parecidas: a partir de un 10 % */
  loadDiffPct: 0.1,
  /** relación velocidad/pulso frente a las parecidas: a partir de un 4 % */
  efficiencyDiffPct: 0.04,
  /** mitades: más de 5 s/km de diferencia */
  halvesS: 5,
  /** desacople: por encima del 5 %, el pulso subió al mismo ritmo */
  decouplingPct: 5,
  /** entorno */
  heatC: 24,
  coldC: 3,
  humidityPct: 80,
  maxLines: 5,
} as const;

export type Tone = "good" | "watch" | "neutral";
export interface SummaryLine {
  text: string;
  tone: Tone;
}

export interface SummaryRun {
  type: string | null;
  distanceM: number | null;
  durationS: number;
  paceS: number | null;
  avgHr: number | null;
  /** segundos por zona (5) */
  zoneSeconds: readonly number[] | null;
  load: number | null;
  isIndoor: boolean;
  temperatureC: number | null;
  humidityPct: number | null;
}

export interface SimilarRun {
  paceS: number | null;
  avgHr: number | null;
  hrReliable: boolean;
  load: number | null;
}

export interface SummaryInput {
  run: SummaryRun;
  /** primera frente a segunda mitad (si se pudo calcular) */
  halves: { paceDeltaS: number; decouplingPct: number | null } | null;
  /** el desacople solo vale en rodaje/tirada larga con ritmo estable */
  decouplingOk: boolean;
  /** las parecidas ya filtradas (mismo tipo, ±20 %, 12 meses, 5 últimas) */
  similar: readonly SimilarRun[];
}

const TYPE_NAME: Record<string, string> = {
  rodaje: "Rodaje",
  tirada_larga: "Tirada larga",
  series: "Series",
  tempo: "Tempo",
  recuperacion: "Recuperación",
  competicion: "Competición",
  trail: "Trail",
  cinta: "Carrera en cinta",
};
/** plural y si es femenino (para «tus últimas … parecidas») */
const TYPE_PLURAL: Record<string, [string, boolean]> = {
  rodaje: ["rodajes", false],
  tirada_larga: ["tiradas largas", true],
  series: ["sesiones de series", true],
  tempo: ["tempos", false],
  recuperacion: ["recuperaciones", true],
  competicion: ["competiciones", true],
  trail: ["trails", false],
  cinta: ["carreras en cinta", true],
};

const fmtKm = (m: number) => (m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 });
const fmtPace = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const pct = (x: number) => `${Math.round(x * 100)} %`;
const dec1 = (x: number) => x.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pulso fiable: hay pulso medio y las muestras cubren al menos el 80 % de la carrera. */
export function hrReliable(r: { avgHr: number | null; zoneSeconds: readonly number[] | null; durationS: number }): boolean {
  if (r.avgHr === null || !r.zoneSeconds || r.durationS <= 0) return false;
  return r.zoneSeconds.reduce((a, b) => a + b, 0) / r.durationS >= SUMMARY_RULES.hrCoverage;
}

/** Velocidad (m/s) por pulsación: más alta = mismo ritmo con menos pulso. */
const efficiency = (paceS: number, hr: number) => 1000 / paceS / hr;

export function runSummary(i: SummaryInput): SummaryLine[] {
  const R = SUMMARY_RULES;
  const r = i.run;
  const hrOk = hrReliable(r);
  const lines: { line: SummaryLine; prio: number }[] = [];
  const add = (prio: number, text: string, tone: Tone) => lines.push({ line: { text, tone }, prio });

  // 1) Tipo y si el pulso encaja con él.
  const name = (r.type && TYPE_NAME[r.type]) || "Carrera";
  const head = r.distanceM ? `${name} de ${fmtKm(r.distanceM)} km` : name;
  const fit = r.type && hrOk ? Object.values(R.zonesFit).find((f) => (f.types as readonly string[]).includes(r.type!)) : undefined;
  if (fit && r.zoneSeconds) {
    const total = r.zoneSeconds.reduce((a, b) => a + b, 0);
    const share = fit.zones.reduce<number>((a, z) => a + (r.zoneSeconds![z] ?? 0), 0) / total;
    const lower = name.toLowerCase();
    if (share >= fit.min) add(0, `${head}; el pulso encaja con el tipo: el ${pct(share)} del tiempo en ${fit.name}.`, "good");
    else if (fit === R.zonesFit.easy) add(0, `${head}; más tiempo en Z3 o más de lo habitual en un${lower === "tirada larga" ? "a" : ""} ${lower}: solo el ${pct(share)} en Z1–Z2.`, "watch");
    else add(0, `${head}; poco tiempo en ${fit.name} para ${r.type === "series" ? "unas series" : `un ${lower}`} (${pct(share)}).`, "watch");
  } else add(0, `${head}.`, "neutral");

  // 2) Frente a las parecidas (mismo tipo, distancia similar, últimos 12 meses).
  const [plural, fem] = (r.type && TYPE_PLURAL[r.type]) || ["carreras", true];
  const parec = fem ? "parecidas" : "parecidos";
  const sims = i.similar.filter((s) => s.paceS !== null);
  if (r.paceS !== null && sims.length >= R.similar.min) {
    const m = mean(sims.map((s) => s.paceS!));
    const d = r.paceS - m;
    const who = `tus ${fem ? "últimas" : "últimos"} ${sims.length} ${plural} ${parec}`;
    if (d <= -R.paceDiffS) add(1, `Mejor ritmo medio que ${who} (${fmtPace(r.paceS)} frente a ${fmtPace(m)} /km).`, "good");
    else if (d >= R.paceDiffS) add(1, `Ritmo medio más lento que ${who} (${fmtPace(r.paceS)} frente a ${fmtPace(m)} /km).`, "neutral");
    else add(1, `Ritmo medio parecido al de ${who} (${fmtPace(r.paceS)} /km).`, "neutral");

    // Relación ritmo/pulso: solo con pulso fiable en esta y en al menos 3 parecidas.
    const withHr = sims.filter((s) => s.hrReliable && s.avgHr !== null);
    if (hrOk && withHr.length >= R.similar.min) {
      const e = efficiency(r.paceS, r.avgHr!);
      const em = mean(withHr.map((s) => efficiency(s.paceS!, s.avgHr!)));
      const rel = e / em - 1;
      if (rel <= -R.efficiencyDiffPct) add(2, `Pulso más alto de lo habitual para ese ritmo (frente a tus ${plural} ${parec} con pulso).`, "watch");
      else if (rel >= R.efficiencyDiffPct) add(2, `Pulso más bajo de lo habitual para ese ritmo (frente a tus ${plural} ${parec} con pulso).`, "good");
    }
  }

  // 3) Mitades (no en series: los intervalos las desordenan).
  if (i.halves && r.type !== "series") {
    const d = Math.round(i.halves.paceDeltaS);
    if (d < -R.halvesS) add(3, `Segunda mitad más rápida que la primera (${-d} s/km).`, "good");
    else if (d > R.halvesS) add(3, `Segunda mitad más lenta que la primera (${d} s/km).`, "watch");
    else add(3, "Mitades parejas: mismo ritmo de principio a fin.", "good");
  }

  // 4) Desacople: solo con pulso fiable y en las sesiones donde vale.
  if (i.decouplingOk && hrOk && i.halves?.decouplingPct != null) {
    const p = i.halves.decouplingPct;
    if (p > R.decouplingPct) add(4, `El pulso subió al mismo ritmo en la segunda mitad (desacople del ${dec1(p)} %).`, "watch");
    else add(4, `Pulso estable para el mismo ritmo (desacople del ${dec1(p)} %).`, "good");
  }

  // 5) Entorno: solo como coincidencia.
  if (!r.isIndoor) {
    const env: string[] = [];
    if (r.temperatureC !== null && r.temperatureC >= R.heatC) env.push(`calor (${dec1(r.temperatureC)} °C)`);
    if (r.temperatureC !== null && r.temperatureC <= R.coldC) env.push(`frío (${dec1(r.temperatureC)} °C)`);
    if (r.humidityPct !== null && r.humidityPct >= R.humidityPct) env.push(`humedad alta (${Math.round(r.humidityPct)} %)`);
    if (env.length) {
      const hot = env.some((e) => e.startsWith("calor") || e.startsWith("humedad"));
      add(5, `Coincidió con ${env.join(" y ")}${hot ? "; con calor o humedad el pulso suele subir" : ""}.`, "neutral");
    }
  }

  // 6) Carga frente a las parecidas.
  const loads = i.similar.filter((s) => s.load !== null).map((s) => s.load!);
  if (r.load !== null && loads.length >= R.similar.min) {
    const m = mean(loads);
    const rel = r.load / m - 1;
    if (rel >= R.loadDiffPct) add(6, `Carga más alta que en tus ${plural} ${parec} (${Math.round(r.load)} frente a ${Math.round(m)}).`, "neutral");
    else if (rel <= -R.loadDiffPct) add(6, `Carga más baja que en tus ${plural} ${parec} (${Math.round(r.load)} frente a ${Math.round(m)}).`, "neutral");
  }

  return lines
    .sort((a, b) => a.prio - b.prio)
    .slice(0, R.maxLines)
    .map((x) => x.line);
}

/**
 * Sesiones parecidas a una carrera: mismo tipo, distancia ±20 %, en los 12 meses anteriores
 * (antes que ella), sin las especiales; las 5 últimas, de la más reciente a la más antigua.
 */
export function pickSimilar<T extends { id: string; type: string | null; startAt: Date; distanceM: number | null; isSpecial: boolean }>(
  cur: { id: string; type: string | null; startAt: Date; distanceM: number | null },
  runs: readonly T[],
): T[] {
  const R = SUMMARY_RULES.similar;
  if (!cur.type || !cur.distanceM) return [];
  const from = cur.startAt.getTime() - R.days * 86_400_000;
  return runs
    .filter(
      (r) =>
        r.id !== cur.id &&
        r.type === cur.type &&
        !r.isSpecial &&
        r.distanceM !== null &&
        Math.abs(r.distanceM / cur.distanceM! - 1) <= R.distPct &&
        r.startAt.getTime() < cur.startAt.getTime() &&
        r.startAt.getTime() >= from,
    )
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
    .slice(0, R.take);
}
