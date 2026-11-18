import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Ajustes clave/valor (p. ej. el hash de la contraseña). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

export type ImportStatus = "uploaded" | "processing" | "done" | "failed";
export type ImportPhase = "index" | "workouts" | "samples" | "series" | "routes" | "finalize" | "done";

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  blobUrl: text("blob_url").notNull(),
  blobPathname: text("blob_pathname").notNull(),
  fileName: text("file_name"),
  fileSize: bigint("file_size", { mode: "number" }),
  exportDate: timestamp("export_date", { withTimezone: true }),
  status: text("status").$type<ImportStatus>().notNull().default("uploaded"),
  phase: text("phase").$type<ImportPhase>().notNull().default("index"),
  /** Bytes descomprimidos de export.xml ya procesados en la pasada actual. */
  bytesProcessed: bigint("bytes_processed", { mode: "number" }).notNull().default(0),
  bytesTotal: bigint("bytes_total", { mode: "number" }),
  /** Punto de control y datos internos del importador (índice del zip, contadores…). */
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  error: text("error"),
  /** Evita que dos invocaciones procesen la misma importación a la vez. */
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: createdAt(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const shoes = pgTable("shoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  brand: text("brand"),
  model: text("model"),
  purchasedAt: date("purchased_at"),
  retiredAt: date("retired_at"),
  initialKm: real("initial_km").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
});

export type RunSource = "apple_watch" | "strava" | "other" | "manual";
export type RunStatus = "valid" | "invalid" | "duplicate";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clave natural para importación idempotente: fuente|inicio|fin (UTC). */
    sourceKey: text("source_key").notNull(),
    source: text("source").$type<RunSource>().notNull(),
    sourceName: text("source_name"),
    sourceVersion: text("source_version"),
    device: text("device"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    durationS: real("duration_s").notNull(),
    distanceM: real("distance_m"),
    avgPaceSPerKm: real("avg_pace_s_per_km"),
    avgHr: real("avg_hr"),
    maxHr: real("max_hr"),
    avgPowerW: real("avg_power_w"),
    avgSpeedMps: real("avg_speed_mps"),
    avgStrideM: real("avg_stride_m"),
    avgVerticalOscCm: real("avg_vertical_osc_cm"),
    avgGroundContactMs: real("avg_ground_contact_ms"),
    steps: integer("steps"),
    cadenceSpm: real("cadence_spm"),
    elevationGainM: real("elevation_gain_m"),
    temperatureC: real("temperature_c"),
    humidityPct: real("humidity_pct"),
    isIndoor: boolean("is_indoor"),
    activeEnergyKcal: real("active_energy_kcal"),
    /** Ruta del GPX dentro del zip según <FileReference>, si existe. */
    routeFile: text("route_file"),
    status: text("status").$type<RunStatus>().notNull().default("valid"),
    invalidReason: text("invalid_reason"),
    duplicateOf: uuid("duplicate_of").references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
    isSpecial: boolean("is_special").notNull().default(false),
    /** Tipo de sesión calculado por reglas (ver src/lib/analysis/session-type.ts). */
    sessionTypeAuto: text("session_type_auto"),
    /** Por qué se eligió el tipo automático (texto corto). */
    sessionTypeReason: text("session_type_reason"),
    /** Tipo elegido a mano; si existe, manda sobre el automático. */
    sessionTypeManual: text("session_type_manual"),
    /** Segundos en Z1…Z5 según las muestras de FC y las zonas guardadas. */
    hrZoneSeconds: real("hr_zone_seconds").array(),
    /** Carga (minutos en zona × 1…5); null si no hay muestras de FC. */
    trainingLoad: real("training_load"),
    /** Dentro de un periodo de lesión: cuenta en km totales, no en medias de ritmo ni comparaciones. */
    inInjury: boolean("in_injury").notNull().default(false),
    /** Ritmo medio (s/km) en los instantes con pulso en Z2, si hubo ≥ 5 min (ver efficiency.ts). */
    efZ2PaceSPerKm: real("ef_z2_pace_s_per_km"),
    efZ2Seconds: real("ef_z2_seconds"),
    /** Nota libre (carreras añadidas a mano; se conserva si el zip la sustituye). */
    /** La carga se estimó solo con el pulso medio (carrera manual sin muestras de pulso). */
    loadEstimated: boolean("load_estimated").notNull().default(false),
    shoeId: uuid("shoe_id").references(() => shoes.id, { onDelete: "set null" }),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    /** Metadatos y estadísticas originales, para trazabilidad. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("runs_source_key_uq").on(t.sourceKey),
    index("runs_start_at_idx").on(t.startAt.desc()),
    index("runs_status_idx").on(t.status, t.isSpecial),
  ],
);

export const runRoutes = pgTable("run_routes", {
  runId: uuid("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  blobUrl: text("blob_url").notNull(),
  fileName: text("file_name").notNull(),
  pointCount: integer("point_count"),
  /** Polyline codificada (precisión 5), simplificada para mapa y miniatura. */
  polyline: text("polyline"),
  minLat: doublePrecision("min_lat"),
  minLon: doublePrecision("min_lon"),
  maxLat: doublePrecision("max_lat"),
  maxLon: doublePrecision("max_lon"),
  gpxDistanceM: real("gpx_distance_m"),
  gpxElevationGainM: real("gpx_elevation_gain_m"),
  createdAt: createdAt(),
});

export const runSplits = pgTable(
  "run_splits",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Km 1, 2, …; el último puede ser parcial. */
    idx: smallint("idx").notNull(),
    distanceM: real("distance_m").notNull(),
    durationS: real("duration_s").notNull(),
    paceSPerKm: real("pace_s_per_km"),
    avgHr: real("avg_hr"),
    avgPowerW: real("avg_power_w"),
    elevationGainM: real("elevation_gain_m"),
    elevationLossM: real("elevation_loss_m"),
    /** Origen de la distancia: muestras del reloj o GPX. */
    basis: text("basis").$type<"samples" | "gpx">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.idx] })],
);

export type SeriesMetric = "hr" | "power" | "speed" | "distance";

export const runSeries = pgTable(
  "run_series",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    metric: text("metric").$type<SeriesMetric>().notNull(),
    /** Segundos desde el inicio de la carrera. */
    t: integer("t").array().notNull(),
    v: real("v").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.metric] })],
);

/** Muestras parciales recogidas durante una importación (se fusionan al final). */
export const importSamples = pgTable(
  "import_samples",
  {
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    metric: text("metric").$type<SeriesMetric>().notNull(),
    /** Número de lote: cada invocación escribe uno nuevo. */
    seq: integer("seq").notNull(),
    t: integer("t").array().notNull(),
    v: real("v").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.importId, t.runId, t.metric, t.seq] })],
);

export const vo2maxReadings = pgTable(
  "vo2max_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    /** mL/(kg·min) */
    value: real("value").notNull(),
    sourceName: text("source_name").notNull().default(""),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("vo2max_measured_source_uq").on(t.measuredAt, t.sourceName),
    index("vo2max_measured_idx").on(t.measuredAt),
  ],
);


/** Periodos de lesión (fechas en hora de Madrid; sin fin = sigue abierto). */
export const injuries = pgTable("injuries", {
  id: uuid("id").primaryKey().defaultRandom(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  note: text("note"),
  createdAt: createdAt(),
});

/**
 * Pista con tiempo de cada carrera con GPX (para sincronizar mapa y gráficos): como mucho un
 * punto cada 2 s, sacada del GPX completo de Blob la primera vez que se abre la carrera.
 * `t` en s desde el inicio; `ele` puede tener nulos.
 */
export const runTracks = pgTable("run_tracks", {
  runId: uuid("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  t: real("t").array().notNull(),
  lat: doublePrecision("lat").array().notNull(),
  lon: doublePrecision("lon").array().notNull(),
  ele: real("ele").array(),
  createdAt: createdAt(),
});

/** Mejor esfuerzo de cada carrera por distancia (tramos continuos; ver best-efforts.ts). */
export const runEfforts = pgTable(
  "run_efforts",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    distanceM: real("distance_m").notNull(),
    timeS: real("time_s").notNull(),
    startS: real("start_s").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.key] }), index("run_efforts_key_time_idx").on(t.key, t.timeS)],
);

/**
 * Plan guardado de cada semana (lunes a domingo): se congela cuando la semana pasa a ser la
 * actual, para que no cambie al recalcular. «Reorganizar» solo mueve el día.
 */
export const planWeeks = pgTable("plan_weeks", {
  weekStart: date("week_start").primaryKey(),
  shiftKind: text("shift_kind").notNull(),
  session: text("session").notNull(),
  day: date("day").notNull(),
  whenText: text("when_text"),
  reason: text("reason").notNull(),
  downgraded: boolean("downgraded").notNull().default(false),
  /** día previsto antes de reorganizar (null si no se reorganizó) */
  rescheduledFrom: date("rescheduled_from"),
  /** sugerencia quitada por mí (no se muestra) */
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Sensaciones de cada carrera (valoración 1–5, nota ≤ 500, etiquetas). Tabla aparte: las filas
 * de `runs` se recalculan al reprocesar, esto no.
 */
export const runFeelings = pgTable("run_feelings", {
  runId: uuid("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  rating: smallint("rating"),
  note: text("note"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Carreras objetivo (puede haber varias; la más próxima manda en Plan e Inicio). El GPX solo
 * aporta el perfil de altitud, ya escalado a la distancia oficial.
 */
export const raceGoals = pgTable("race_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  date: date("date").notNull(),
  distanceKey: text("distance_key").notNull(),
  distanceM: real("distance_m").notNull(),
  /** HH:MM o null */
  startTime: text("start_time"),
  targetS: real("target_s").notNull(),
  /** uniforme / negativa 2 % / negativa 5 % / positiva */
  strategy: text("strategy").notNull().default("even"),
  /** { d: number[], e: number[], gpxM, scale, gainM } */
  profile: jsonb("profile"),
  /** carrera real vinculada tras correrla */
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Sesiones previstas puestas por mí en Plan (mandan sobre la sugerencia). */
export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    /** tirada_larga | calidad | suave | otro */
    kind: text("kind").notNull(),
    distanceM: real("distance_m"),
    durationS: integer("duration_s"),
    note: text("note"),
    /** semana (lunes) cuya sugerencia sustituye, si se creó editando la sugerida */
    replacesWeek: date("replaces_week"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("planned_sessions_date_idx").on(t.date)],
);
