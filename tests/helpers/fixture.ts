/**
 * Export de Apple Health SINTÉTICO para pruebas. No contiene datos reales: solo
 * reproduce la estructura del export y, para la carrera de referencia, los
 * valores de comprobación que dio el usuario (21,34 km · 1:41:41 · FC 156 · 252 W).
 */
import { makeZip } from "./zip-writer";

const WATCH = "Apple Watch de Prueba";
const PHONE = "iPhone de Prueba";
const WATCH_DEVICE = "&lt;&lt;HKDevice: 0x1&gt;, name:Apple Watch, model:Watch, hardware:Watch7,5&gt;";

const pad = (n: number) => String(n).padStart(2, "0");
/** Fecha en formato Apple con zona +0200. */
function fmt(ms: number, tz = "+0200"): string {
  const sign = tz[0] === "-" ? -1 : 1;
  const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const d = new Date(ms + offMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())} ${tz}`;
}

const rec = (type: string, source: string, unit: string, start: number, end: number, value: number | string) =>
  `<Record type="HKQuantityTypeIdentifier${type}" sourceName="${source}" sourceVersion="11.0" unit="${unit}" creationDate="${fmt(
    end,
  )}" startDate="${fmt(start)}" endDate="${fmt(end)}" value="${value}"/>`;

const stat = (type: string, start: number, end: number, fields: string, unit: string) =>
  `<WorkoutStatistics type="HKQuantityTypeIdentifier${type}" startDate="${fmt(start)}" endDate="${fmt(end)}" ${fields} unit="${unit}"/>`;

function workout(o: {
  type?: string;
  source: string;
  device?: string;
  start: number;
  durationMin: number;
  inner?: string;
  attrs?: string;
}): string {
  const end = o.start + o.durationMin * 60_000;
  return `<Workout workoutActivityType="${o.type ?? "HKWorkoutActivityTypeRunning"}" duration="${o.durationMin}" durationUnit="min" sourceName="${o.source}" sourceVersion="11.0"${
    o.device ? ` device="${o.device}"` : ""
  }${o.attrs ?? ""} creationDate="${fmt(end)}" startDate="${fmt(o.start)}" endDate="${fmt(end)}">\n${o.inner ?? ""}\n</Workout>`;
}

function gpx(points: { lat: number; lon: number; ele: number; t: number }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Apple Health Export"><trk><name>Route</name><trkseg>
${points
  .map((p) => `<trkpt lon="${p.lon.toFixed(6)}" lat="${p.lat.toFixed(6)}"><ele>${p.ele.toFixed(2)}</ele><time>${new Date(p.t).toISOString().replace(".000", "")}</time></trkpt>`)
  .join("\n")}
</trkseg></trk></gpx>`;
}

/** Recorrido recto hacia el norte a velocidad constante, con una cuesta suave. */
function straightRoute(start: number, durationS: number, meters: number, everyS = 10) {
  const pts = [];
  const metersPerDegLat = 111_195;
  for (let s = 0; s <= durationS; s += everyS) {
    const d = (meters * s) / durationS;
    pts.push({ lat: 40.4 + d / metersPerDegLat, lon: -3.7, ele: 650 + 20 * Math.sin((d / meters) * Math.PI), t: start + s * 1000 });
  }
  return pts;
}

export const REF_START = Date.parse("2026-10-17T07:00:00Z"); // 09:00 en Madrid
export const REF_DURATION_S = 6101; // 1:41:41
export const REF_DISTANCE_M = 21_340;

export function buildFixture(opts: { filler?: number } = {}): { zip: Buffer; xml: string } {
  const recs: string[] = [];
  // Relleno: registros que el importador debe ignorar (para pruebas con varios MB).
  for (let i = 0; i < (opts.filler ?? 0); i++) {
    const t = Date.parse("2025-01-01T00:00:00Z") + i * 60_000;
    recs.push(rec("StepCount", PHONE, "count", t, t + 60_000, 42));
  }
  const workouts: string[] = [];
  const files: { name: string; data: string }[] = [];

  // ── W1: carrera de referencia (Apple Watch, exterior, con ruta) ──
  const w1End = REF_START + REF_DURATION_S * 1000;
  for (let s = 0; s < REF_DURATION_S; s += 60) {
    const e = Math.min(s + 60, REF_DURATION_S);
    recs.push(rec("DistanceWalkingRunning", WATCH, "km", REF_START + s * 1000, REF_START + e * 1000, ((REF_DISTANCE_M * (e - s)) / REF_DURATION_S / 1000).toFixed(6)));
    // El iPhone también registra distancia a la vez: no debe contarse.
    recs.push(rec("DistanceWalkingRunning", PHONE, "km", REF_START + s * 1000, REF_START + e * 1000, "0.9"));
  }
  for (let s = 0; s < REF_DURATION_S; s += 30) {
    recs.push(rec("HeartRate", WATCH, "count/min", REF_START + s * 1000, REF_START + s * 1000, s < REF_DURATION_S / 2 ? 150 : 162));
    recs.push(rec("RunningPower", WATCH, "W", REF_START + s * 1000, REF_START + s * 1000, 252));
  }
  recs.push(rec("HeartRate", PHONE, "count/min", REF_START + 5000, REF_START + 5000, 60));
  const w1Inner = [
    `<MetadataEntry key="HKIndoorWorkout" value="0"/>`,
    `<MetadataEntry key="HKElevationAscended" value="8500 cm"/>`,
    `<MetadataEntry key="HKWeatherTemperature" value="59 degF"/>`,
    `<MetadataEntry key="HKWeatherHumidity" value="7200 %"/>`,
    `<WorkoutActivity uuid="X" startDate="${fmt(REF_START)}" endDate="${fmt(w1End)}" duration="101.6833333333333" durationUnit="min">`,
    stat("DistanceWalkingRunning", REF_START, w1End, 'sum="21.34"', "km"),
    stat("HeartRate", REF_START, w1End, 'average="156" minimum="120" maximum="174"', "count/min"),
    stat("RunningPower", REF_START, w1End, 'average="252" minimum="100" maximum="400"', "W"),
    stat("RunningSpeed", REF_START, w1End, 'average="12.59" minimum="8" maximum="18"', "km/hr"),
    stat("RunningStrideLength", REF_START, w1End, 'average="1.21"', "m"),
    stat("RunningVerticalOscillation", REF_START, w1End, 'average="8.9"', "cm"),
    stat("RunningGroundContactTime", REF_START, w1End, 'average="245"', "ms"),
    stat("StepCount", REF_START, w1End, 'sum="17690"', "count"),
    stat("ActiveEnergyBurned", REF_START, w1End, 'sum="1420"', "Cal"),
    `</WorkoutActivity>`,
    // Repeticiones a nivel de Workout con otros valores: se usa la PRIMERA aparición.
    stat("DistanceWalkingRunning", REF_START, w1End, 'sum="99"', "km"),
    stat("HeartRate", REF_START, w1End, 'average="99"', "count/min"),
    `<WorkoutRoute sourceName="${WATCH}" sourceVersion="11.0" creationDate="${fmt(w1End)}" startDate="${fmt(REF_START)}" endDate="${fmt(w1End)}">`,
    `<MetadataEntry key="HKMetadataKeySyncVersion" value="2"/>`,
    `<FileReference path="/workout-routes/route_2026-10-17_10.41am.gpx"/>`,
    `</WorkoutRoute>`,
  ].join("\n");
  workouts.push(workout({ source: WATCH, device: WATCH_DEVICE, start: REF_START, durationMin: REF_DURATION_S / 60, inner: w1Inner }));
  files.push({ name: "apple_health_export/workout-routes/route_2026-10-17_10.41am.gpx", data: gpx(straightRoute(REF_START, REF_DURATION_S, 21_300)) });

  // ── W2: la misma carrera subida por Strava 5 min después → duplicada ──
  const w2Start = REF_START + 5 * 60_000;
  workouts.push(
    workout({
      source: "Strava",
      start: w2Start,
      durationMin: 100,
      inner: stat("DistanceWalkingRunning", w2Start, w2Start + 6_000_000, 'sum="21.2"', "km"),
    }),
  );

  // ── W3: andar → se descarta ──
  const w3Start = Date.parse("2026-10-18T08:00:00Z");
  workouts.push(
    workout({
      type: "HKWorkoutActivityTypeWalking",
      source: WATCH,
      device: WATCH_DEVICE,
      start: w3Start,
      durationMin: 30,
      inner: stat("DistanceWalkingRunning", w3Start, w3Start + 1_800_000, 'sum="2.5"', "km"),
    }),
  );

  // ── W4: carrera de 0,3 km → no válida ──
  const w4Start = Date.parse("2026-10-19T08:00:00Z");
  workouts.push(
    workout({
      source: WATCH,
      device: WATCH_DEVICE,
      start: w4Start,
      durationMin: 2,
      inner: stat("DistanceWalkingRunning", w4Start, w4Start + 120_000, 'sum="0.3"', "km"),
    }),
  );

  // ── W5: series a 9:00 /km → válida pero «sesión especial» ──
  const w5Start = Date.parse("2026-10-20T17:00:00Z");
  workouts.push(
    workout({
      source: WATCH,
      device: WATCH_DEVICE,
      start: w5Start,
      durationMin: 45,
      inner: stat("DistanceWalkingRunning", w5Start, w5Start + 2_700_000, 'sum="5"', "km"),
    }),
  );

  // ── W6: cinta (indoor), sin ruta: parciales desde la distancia del reloj ──
  const w6Start = Date.parse("2024-03-01T18:00:00Z");
  const w6Dur = 2400; // 40 min, 8 km
  for (let s = 0; s < w6Dur; s += 20) {
    recs.push(rec("DistanceWalkingRunning", WATCH, "m", w6Start + s * 1000, w6Start + (s + 20) * 1000, ((8000 * 20) / w6Dur).toFixed(4)));
  }
  workouts.push(
    workout({
      source: WATCH,
      device: WATCH_DEVICE,
      start: w6Start,
      durationMin: w6Dur / 60,
      inner: [`<MetadataEntry key="HKIndoorWorkout" value="1"/>`, stat("DistanceWalkingRunning", w6Start, w6Start + w6Dur * 1000, 'sum="8"', "km")].join("\n"),
    }),
  );

  // ── W7: 2016, formato antiguo (totalDistance), GPX sin referencia → por hora ──
  const w7Start = Date.parse("2016-05-10T06:30:00Z");
  workouts.push(
    workout({
      source: PHONE,
      device: "&lt;&lt;HKDevice: 0x2&gt;, name:iPhone&gt;",
      start: w7Start,
      durationMin: 55,
      attrs: ` totalDistance="10" totalDistanceUnit="km"`,
    }),
  );
  files.push({ name: "apple_health_export/workout-routes/route_2016-05-10_9.25am.gpx", data: gpx(straightRoute(w7Start, 55 * 60, 10_050, 15)) });

  // Un GPX huérfano que no corresponde a ninguna carrera.
  files.push({ name: "apple_health_export/workout-routes/route_2020-01-01_1.00pm.gpx", data: gpx(straightRoute(Date.parse("2020-01-01T12:00:00Z"), 600, 1000)) });

  // VO₂ máx.
  recs.push(rec("VO2Max", WATCH, "mL/min·kg", Date.parse("2025-07-01T10:00:00Z"), Date.parse("2025-07-01T10:00:00Z"), 60.1));
  recs.push(rec("VO2Max", WATCH, "mL/min·kg", Date.parse("2026-11-01T10:00:00Z"), Date.parse("2026-11-01T10:00:00Z"), 50.8));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [ <!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)> ]>
<HealthData locale="es_ES">
 <ExportDate value="${fmt(Date.parse("2026-11-16T20:00:00Z"))}"/>
 <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>
${recs.join("\n")}
${workouts.join("\n")}
 <ActivitySummary dateComponents="2026-11-15" activeEnergyBurned="500"/>
</HealthData>
`;
  const zip = makeZip([
    { name: "apple_health_export/exportación.xml", data: xml },
    { name: "apple_health_export/exportación_cda.xml", data: "<ClinicalDocument/>" },
    ...files,
  ]);
  return { zip, xml };
}
