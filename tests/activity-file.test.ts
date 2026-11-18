import { describe, expect, it } from "vitest";
import { ActivityFileError, fileSeries, parseActivityFile, toGpx } from "@/lib/import/activity-file";

const T0 = Date.parse("2026-11-15T08:00:00Z");
const enc = (s: string) => new TextEncoder().encode(s);

/** GPX de Strava: 1 punto cada 2 s a ~3 m/s hacia el norte, con pulso y cadencia (zancadas/min). */
function stravaGpx(n = 600) {
  const pts = Array.from({ length: n }, (_, i) => {
    const lat = 43 + (i * 6) / 111_195; // 6 m cada 2 s
    return `<trkpt lat="${lat.toFixed(7)}" lon="-3.0000000"><ele>${(10 + i * 0.05).toFixed(1)}</ele><time>${new Date(T0 + i * 2000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${140 + (i % 10)}</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`;
  });
  return `<?xml version="1.0"?><gpx creator="StravaGPX" xmlns:gpxtpx="x"><trk><name>Rodaje</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

describe("GPX de Strava", () => {
  const f = parseActivityFile("Rodaje.gpx", enc(stravaGpx()));
  it("puntos con hora, ruta, altitud, pulso y cadencia en pasos/min", () => {
    expect(f.kind).toBe("gpx");
    expect(f.points).toHaveLength(600);
    expect(f.points[0]).toMatchObject({ hr: 140, cad: 170, lat: 43, lon: -3, ele: 10 });
  });
  it("resumen: inicio, distancia, duración, pulso medio y máximo, desnivel", () => {
    const s = f.summary;
    expect(s.startAt!.getTime()).toBe(T0);
    expect(s.distanceM!).toBeCloseTo(599 * 6, -1);
    expect(s.durationS).toBe(1198);
    expect(s.avgHr!).toBeCloseTo(144.5, 0);
    expect(s.maxHr).toBe(149);
    expect(s.elevationGainM!).toBeGreaterThan(25);
    expect(s.hasGps).toBe(true);
  });
  it("series como las del reloj: distancia por intervalos, pulso", () => {
    const sr = fileSeries(f.points, T0);
    expect(sr.distance!.t[0]).toBe(2);
    expect(sr.distance!.v[0]).toBeCloseTo(6, 1);
    expect(sr.distance!.v.reduce((a, b) => a + b, 0)).toBeCloseTo(f.summary.distanceM!, -1);
    expect(sr.hr!.t.length).toBe(600);
    expect(sr.power).toBeNull();
  });
  it("se puede volver a escribir como GPX con hora y altitud", () => {
    const back = parseActivityFile("x.gpx", enc(toGpx(f.points)));
    expect(back.points).toHaveLength(600);
    expect(back.points[10].ele).toBeCloseTo(f.points[10].ele!, 1);
  });
});

describe("TCX", () => {
  const tp = (i: number) =>
    `<Trackpoint><Time>${new Date(T0 + i * 1000).toISOString()}</Time><Position><LatitudeDegrees>43.1</LatitudeDegrees><LongitudeDegrees>-3.1</LongitudeDegrees></Position><AltitudeMeters>50</AltitudeMeters><DistanceMeters>${(i * 3).toFixed(1)}</DistanceMeters><HeartRateBpm><Value>${150}</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:RunCadence>88</ns3:RunCadence><ns3:Watts>260</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
  const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap><Track>${Array.from({ length: 301 }, (_, i) => tp(i)).join("")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const f = parseActivityFile("run.tcx", enc(xml));
  it("usa la distancia del archivo, pulso, cadencia y potencia", () => {
    expect(f.summary.distanceM).toBe(900);
    expect(f.summary.avgHr).toBeCloseTo(150, 6);
    expect(f.points[0]).toMatchObject({ cad: 176, power: 260, dist: 0 });
    expect(fileSeries(f.points, T0).power!.v[0]).toBe(260);
  });
});

// ─── FIT: codificador mínimo para las pruebas ───────────────────────────────

const FIT_EPOCH_S = 631065600;
function fitFile(opts: { records: { ts: number; lat?: number; lon?: number; alt?: number; hr?: number; cad?: number; dist?: number; power?: number }[]; session?: Record<string, number>; compressed?: boolean; devField?: boolean; truncate?: number }) {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 0xff);
  const u16 = (v: number) => (u8(v), u8(v >> 8));
  const u32 = (v: number) => (u16(v & 0xffff), u16(v >>> 16));
  const i32 = (v: number) => u32(v >>> 0);
  // definición del record (local 0): timestamp, lat, lon, enhanced_altitude, hr, cad, distance, power
  u8(0x40 | (opts.devField ? 0x20 : 0));
  u8(0);
  u8(0);
  u16(20);
  const fields = [
    [253, 4, 0x86],
    [0, 4, 0x85],
    [1, 4, 0x85],
    [78, 4, 0x86],
    [3, 1, 0x02],
    [4, 1, 0x02],
    [5, 4, 0x86],
    [7, 2, 0x84],
  ];
  u8(fields.length);
  for (const f of fields) f.forEach(u8);
  if (opts.devField) {
    u8(1);
    u8(0);
    u8(3); // 3 bytes de campo de desarrollador
    u8(0);
  }
  // definición sin timestamp (local 1) para las cabeceras comprimidas
  if (opts.compressed) {
    u8(0x41);
    u8(0);
    u8(0);
    u16(20);
    u8(1);
    [3, 1, 0x02].forEach(u8);
  }
  opts.records.forEach((r, i) => {
    if (opts.compressed && i > 0) {
      u8(0x80 | (1 << 5) | ((r.ts - FIT_EPOCH_S) & 0x1f));
      u8(r.hr ?? 0xff);
      return;
    }
    u8(0x00);
    u32(r.ts - FIT_EPOCH_S);
    i32(r.lat !== undefined ? Math.round(r.lat / (180 / 2 ** 31)) : 0x7fffffff);
    i32(r.lon !== undefined ? Math.round(r.lon / (180 / 2 ** 31)) : 0x7fffffff);
    u32(r.alt !== undefined ? Math.round((r.alt + 500) * 5) : 0xffffffff);
    u8(r.hr ?? 0xff);
    u8(r.cad ?? 0xff);
    u32(r.dist !== undefined ? Math.round(r.dist * 100) : 0xffffffff);
    u16(r.power ?? 0xffff);
    if (opts.devField) [1, 2, 3].forEach(u8);
  });
  if (opts.session) {
    u8(0x42);
    u8(0);
    u8(0);
    u16(18);
    const keys = Object.keys(opts.session).map(Number);
    u8(keys.length);
    for (const k of keys) [k, 4, 0x86].forEach(u8);
    u8(0x02);
    for (const k of keys) u32(opts.session[k]);
  }
  const data = opts.truncate ? out.slice(0, out.length - opts.truncate) : out;
  const header = [14, 0x20, 0x08, 0x08, ...[0, 0, 0, 0], ...".FIT".split("").map((c) => c.charCodeAt(0)), 0, 0];
  new DataView(Uint8Array.from(header).buffer).getUint32(4, true);
  const h = Uint8Array.from(header);
  new DataView(h.buffer).setUint32(4, out.length, true);
  return Uint8Array.from([...h, ...data, 0, 0]);
}

describe("FIT", () => {
  const s0 = T0 / 1000;
  const recs = Array.from({ length: 121 }, (_, i) => ({ ts: s0 + i, lat: 43 + i * 3e-5, lon: -3, alt: 20 + i * 0.1, hr: 150, cad: 86, dist: i * 3.2, power: 250 }));

  it("lee los records: posición, altitud, pulso, cadencia (pasos/min), distancia y potencia", () => {
    const f = parseActivityFile("Morning_Run.fit", fitFile({ records: recs }));
    expect(f.kind).toBe("fit");
    expect(f.points).toHaveLength(121);
    const p = f.points[10];
    expect(p.t).toBe(T0 + 10_000);
    expect(p.lat!).toBeCloseTo(43.0003, 5);
    expect(p.ele!).toBeCloseTo(21, 1);
    expect(p).toMatchObject({ hr: 150, cad: 172, power: 250 });
    expect(p.dist!).toBeCloseTo(32, 6);
    expect(f.summary.distanceM!).toBeCloseTo(384, 6);
  });

  it("los totales de la sesión mandan (tiempo en movimiento, pulso, desnivel)", () => {
    const f = parseActivityFile(
      "a.fit",
      fitFile({ records: recs, session: { 2: s0 - FIT_EPOCH_S, 8: 115_000, 9: 38_400, 16: 151, 17: 170, 22: 12 } }),
    );
    expect(f.summary).toMatchObject({ durationS: 115, distanceM: 384, avgHr: 151, maxHr: 170, elevationGainM: 12 });
    expect(f.summary.startAt!.getTime()).toBe(T0);
  });

  it("marcas de tiempo comprimidas y campos de desarrollador", () => {
    const f = parseActivityFile("c.fit", fitFile({ records: recs.slice(0, 40), compressed: true }));
    expect(f.points.map((p) => (p.t - T0) / 1000)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(f.points[39].hr).toBe(150);
    const d = parseActivityFile("d.fit", fitFile({ records: recs.slice(0, 10), devField: true }));
    expect(d.points).toHaveLength(10);
    expect(d.points[9].power).toBe(250);
  });

  it("sin GPS (cinta): sin ruta, con la distancia del reloj", () => {
    const f = parseActivityFile("cinta.fit", fitFile({ records: recs.map((r) => ({ ...r, lat: undefined, lon: undefined })) }));
    expect(f.summary.hasGps).toBe(false);
    expect(f.summary.distanceM!).toBeCloseTo(384, 6);
  });

  it("archivo cortado al final: usa lo leído; dañado del todo: error claro", () => {
    const f = parseActivityFile("t.fit", fitFile({ records: recs, truncate: 7 }));
    expect(f.points.length).toBeGreaterThan(100);
    expect(() => parseActivityFile("x.fit", enc("hola, no soy un fit"))).toThrow(ActivityFileError);
  });
});

describe("errores claros", () => {
  it("extensión no admitida o sin puntos con hora", () => {
    expect(() => parseActivityFile("a.kml", enc("<kml/>"))).toThrow(/\.gpx, \.tcx o \.fit/);
    expect(() => parseActivityFile("a.gpx", enc("<gpx><trk><trkseg><trkpt lat='1' lon='1'></trkpt></trkseg></trk></gpx>"))).toThrow(/puntos con hora/);
  });
});
