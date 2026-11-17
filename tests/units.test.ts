import { describe, expect, it } from "vitest";
import { classifyRuns } from "@/lib/import/classify";
import { decodePolyline, elevationGainLoss, encodePolyline, haversine, parseGpx, simplify } from "@/lib/import/gpx";
import { XmlScanner } from "@/lib/import/scanner";
import { computeSplits, cumulativeFromIntervals } from "@/lib/import/splits";
import { humidityPct, temperatureC, toMps } from "@/lib/import/units";
import { parseRunningWorkout } from "@/lib/import/workout";
import { parseHealthDate } from "@/lib/import/xml";
import { bufferSource, readCentralDirectory, readSmallEntry } from "@/lib/import/zip";
import { REF_DISTANCE_M, REF_DURATION_S, buildFixture } from "./helpers/fixture";
import { makeZip } from "./helpers/zip-writer";

describe("fechas y unidades", () => {
  it("lee fechas de Apple con zona horaria", () => {
    expect(parseHealthDate("2026-10-17 09:00:00 +0200")?.toISOString()).toBe("2026-10-17T07:00:00.000Z");
  });
  it("convierte temperatura, humedad y velocidad", () => {
    expect(temperatureC("59 degF")).toBeCloseTo(15, 5);
    expect(humidityPct("7200 %")).toBe(72);
    expect(humidityPct("65 %")).toBe(65);
    expect(toMps("12.6", "km/hr")).toBeCloseTo(3.5, 5);
  });
});

describe("Workout de correr", () => {
  const { xml } = buildFixture();
  const start = xml.indexOf("<Workout ");
  const w1 = xml.slice(start, xml.indexOf("</Workout>", start) + 10);

  it("comprobación del 17-oct: 21,34 km, 1:41:41, 4:46/km, FC 156, 252 W", () => {
    const r = parseRunningWorkout(w1)!;
    expect(r.distanceM).toBeCloseTo(21_340, 3);
    expect(Math.round(r.durationS)).toBe(6101);
    const pace = Math.round(r.avgPaceSPerKm!);
    expect(`${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, "0")}`).toBe("4:46");
    expect(r.avgHr).toBe(156);
    expect(r.avgPowerW).toBe(252);
  });

  it("usa la primera aparición de cada estadística y lee metadatos", () => {
    const r = parseRunningWorkout(w1)!;
    expect(r.maxHr).toBe(174);
    expect(r.source).toBe("apple_watch");
    expect(r.avgStrideM).toBeCloseTo(1.21);
    expect(r.avgVerticalOscCm).toBeCloseTo(8.9);
    expect(r.avgGroundContactMs).toBe(245);
    expect(r.cadenceSpm).toBeCloseTo(17690 / (6101 / 60), 3);
    expect(r.elevationGainM).toBe(85);
    expect(r.temperatureC).toBeCloseTo(15);
    expect(r.humidityPct).toBe(72);
    expect(r.isIndoor).toBe(false);
    expect(r.routeFile).toBe("workout-routes/route_2026-10-17_10.41am.gpx");
  });

  it("guarda todas las rutas de paso de intervalos distintas", () => {
    const ev = (k: string) =>
      `<WorkoutEvent type="HKWorkoutEventTypeSegment" date="2026-10-17 09:00:00 +0200"><MetadataEntry key="WOIntervalStepKeyPath" value="${k}"/></WorkoutEvent>`;
    const xml = w1.replace("</Workout>", ["0.0.0", "1.0.0", "1.0.1", "1.0.1", "1.1.0"].map(ev).join("\n") + "\n</Workout>");
    expect(parseRunningWorkout(xml)!.raw.intervalSteps).toEqual(["0.0.0", "1.0.0", "1.0.1", "1.1.0"]);
    expect(parseRunningWorkout(w1)!.raw.intervalSteps).toEqual([]);
  });

  it("descarta lo que no es correr", () => {
    expect(parseRunningWorkout(w1.replace("HKWorkoutActivityTypeRunning", "HKWorkoutActivityTypeWalking"))).toBeNull();
  });

  it("sin estadística de distancia, la deja vacía (no la inventa)", () => {
    const noDist = w1.replace(/<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning"[^>]*>/g, "");
    const r = parseRunningWorkout(noDist)!;
    expect(r.distanceM).toBeNull();
    expect(r.avgPaceSPerKm).toBeNull();
  });
});

describe("escáner en streaming", () => {
  it("encuentra los mismos elementos aunque se corten entre trozos", () => {
    const { xml } = buildFixture();
    const buf = Buffer.from(xml, "utf8");
    const targets = [
      { id: "w", start: "<Workout ", block: { close: "</Workout>" } },
      { id: "vo2", start: '<Record type="HKQuantityTypeIdentifierVO2Max"' },
    ];
    const whole: string[] = [];
    const a = new XmlScanner(targets, 0, 1);
    a.push(buf, (m) => whole.push(m.text));
    a.flush((m) => whole.push(m.text));

    for (const size of [1, 7, 333, 4096]) {
      const got: string[] = [];
      const sc = new XmlScanner(targets, 0, 1);
      for (let i = 0; i < buf.length; i += size) sc.push(buf.subarray(i, i + size), (m) => got.push(m.text));
      sc.flush((m) => got.push(m.text));
      expect(got).toEqual(whole);
    }
    expect(whole.filter((t) => t.startsWith("<Workout")).length).toBe(10);
    expect(whole.filter((t) => t.includes("VO2Max")).length).toBe(2);
  });

  it("reanuda desde safeOffset sin perder ni repetir elementos", () => {
    const { xml } = buildFixture();
    const buf = Buffer.from(xml, "utf8");
    const targets = [{ id: "w", start: "<Workout ", block: { close: "</Workout>" } }];
    const first: string[] = [];
    const sc = new XmlScanner(targets, 0, 1);
    const cut = Math.floor(buf.length * 0.93); // a mitad de los Workout
    sc.push(buf.subarray(0, cut), (m) => first.push(m.text));
    sc.flush((m) => first.push(m.text));
    const resume = sc.safeOffset;
    const second: string[] = [];
    const sc2 = new XmlScanner(targets, resume, 1);
    sc2.push(buf.subarray(resume), (m) => second.push(m.text));
    sc2.flush((m) => second.push(m.text));
    expect(first.length + second.length).toBe(10);
  });
});

describe("zip por rangos", () => {
  it("lee el directorio central y extrae una entrada", async () => {
    const zip = makeZip([
      { name: "a/hola.txt", data: "hola mundo" },
      { name: "a/b.txt", data: "x".repeat(10_000), store: true },
    ]);
    const src = bufferSource(zip);
    const entries = await readCentralDirectory(src);
    expect(entries.map((e) => e.name)).toEqual(["a/hola.txt", "a/b.txt"]);
    expect((await readSmallEntry(src, entries[0])).toString()).toBe("hola mundo");
    expect((await readSmallEntry(src, entries[1])).length).toBe(10_000);
  });
});

describe("GPX y parciales", () => {
  it("distancia, desnivel y polyline", () => {
    const pts = parseGpx(
      `<gpx><trk><trkseg><trkpt lat="40" lon="-3"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="40.001" lon="-3"><ele>12</ele><time>2026-01-01T00:00:30Z</time></trkpt></trkseg></trk></gpx>`,
    );
    expect(pts).toHaveLength(2);
    expect(haversine(pts[0], pts[1])).toBeCloseTo(111.2, 0);
    expect(elevationGainLoss(pts.map((p) => p.ele)).gain).toBe(2);
    const enc = encodePolyline(simplify(pts));
    expect(decodePolyline(enc)).toEqual([
      [40, -3],
      [40.001, -3],
    ]);
  });

  it("parciales por km desde muestras por intervalo", () => {
    const dist = cumulativeFromIntervals({ t: [300, 600, 900], v: [1000, 1000, 600] });
    const splits = computeSplits(dist, { hr: { t: [0, 100, 400, 700], v: [140, 150, 160, 170] } });
    expect(splits.map((s) => Math.round(s.durationS))).toEqual([300, 300, 300]);
    expect(splits[2].distanceM).toBeCloseTo(600);
    expect(splits[0].avgHr).toBe(145);
    expect(splits[2].paceSPerKm).toBeCloseTo(500);
  });

  it("la carrera de referencia da 21 km completos + parcial", () => {
    const n = Math.ceil(REF_DURATION_S / 60);
    const t = Array.from({ length: n }, (_, i) => Math.min((i + 1) * 60, REF_DURATION_S));
    const v = t.map((e, i) => (REF_DISTANCE_M * (e - (i ? t[i - 1] : 0))) / REF_DURATION_S);
    const splits = computeSplits(cumulativeFromIntervals({ t, v }));
    expect(splits).toHaveLength(22);
    expect(splits[21].distanceM).toBeCloseTo(340, 0);
  });
});

describe("clasificación", () => {
  const d = (iso: string) => new Date(iso);
  it("duplicado Strava, distancia mínima y sesión especial", () => {
    const res = classifyRuns([
      { id: "w", source: "apple_watch", startAt: d("2026-10-17T07:00:00Z"), distanceM: 21340, avgPaceSPerKm: 286 },
      { id: "s", source: "strava", startAt: d("2026-10-17T07:25:00Z"), distanceM: 21200, avgPaceSPerKm: 283 },
      { id: "s2", source: "strava", startAt: d("2026-10-17T07:31:00Z"), distanceM: 5000, avgPaceSPerKm: 300 },
      { id: "short", source: "apple_watch", startAt: d("2026-10-19T08:00:00Z"), distanceM: 300, avgPaceSPerKm: 400 },
      { id: "slow", source: "apple_watch", startAt: d("2026-10-20T17:00:00Z"), distanceM: 5000, avgPaceSPerKm: 540 },
      { id: "none", source: "other", startAt: d("2016-01-01T00:00:00Z"), distanceM: null, avgPaceSPerKm: null },
    ]);
    expect(res.get("w")).toMatchObject({ status: "valid", isSpecial: false });
    expect(res.get("s")).toMatchObject({ status: "duplicate", duplicateOf: "w" });
    expect(res.get("s2")).toMatchObject({ status: "valid" }); // 31 min: fuera de la ventana
    expect(res.get("short")).toMatchObject({ status: "invalid", invalidReason: "menos_de_0_5_km" });
    expect(res.get("slow")).toMatchObject({ status: "valid", isSpecial: true });
    expect(res.get("none")).toMatchObject({ status: "invalid", invalidReason: "sin_distancia" });
  });
});
