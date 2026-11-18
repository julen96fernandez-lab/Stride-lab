/**
 * Archivos de actividad exportados de Strava u otras apps (.gpx, .tcx, .fit) para las carreras
 * añadidas a mano. Puro (sin Node): sirve en el navegador (rellenar el formulario) y en el
 * servidor (guardar). Solo se lee lo que trae el archivo; lo que falte queda en null.
 */
import { elevationGainLoss, haversine } from "./gpx";

export interface ActivityPoint {
  /** ms desde epoch */
  t: number;
  lat: number | null;
  lon: number | null;
  ele: number | null;
  hr: number | null;
  /** pasos por minuto */
  cad: number | null;
  power: number | null;
  /** distancia acumulada del archivo (m), si la trae */
  dist: number | null;
}

export interface ActivitySummary {
  startAt: Date | null;
  distanceM: number | null;
  /** tiempo en movimiento si el archivo lo trae (FIT), si no, tiempo transcurrido */
  durationS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  avgCadence: number | null;
  avgPower: number | null;
  hasGps: boolean;
}

export interface ActivityFile {
  kind: "gpx" | "tcx" | "fit";
  points: ActivityPoint[];
  summary: ActivitySummary;
}

export class ActivityFileError extends Error {}

export function activityKind(name: string): ActivityFile["kind"] | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "gpx" || ext === "tcx" || ext === "fit" ? ext : null;
}

export function parseActivityFile(name: string, bytes: Uint8Array): ActivityFile {
  const kind = activityKind(name);
  if (!kind) throw new ActivityFileError("El archivo tiene que ser .gpx, .tcx o .fit.");
  let points: ActivityPoint[];
  let session: Partial<ActivitySummary> = {};
  if (kind === "fit") {
    const r = parseFit(bytes);
    points = r.points;
    session = r.session;
  } else {
    const text = new TextDecoder("utf-8").decode(bytes);
    points = kind === "gpx" ? parseGpxPoints(text) : parseTcxPoints(text);
  }
  points = points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (points.length < 2) throw new ActivityFileError("El archivo no tiene puntos con hora: no se puede usar.");
  return { kind, points, summary: summarize(points, session) };
}

// ─── Resumen ────────────────────────────────────────────────────────────────

/** Distancia acumulada de cada punto: la del archivo si la trae; si no, por GPS. */
export function cumulative(points: readonly ActivityPoint[]): (number | null)[] {
  if (points.some((p) => p.dist !== null)) {
    let last = 0;
    return points.map((p) => (p.dist !== null ? (last = Math.max(last, p.dist)) : last));
  }
  if (!points.some((p) => p.lat !== null)) return points.map(() => null);
  let acc = 0;
  let prev: ActivityPoint | null = null;
  return points.map((p) => {
    if (p.lat !== null && p.lon !== null) {
      if (prev) acc += haversine({ lat: prev.lat!, lon: prev.lon! }, { lat: p.lat, lon: p.lon });
      prev = p;
    }
    return acc;
  });
}

function timeWeightedMean(points: readonly ActivityPoint[], key: "hr" | "cad" | "power"): number | null {
  let w = 0,
    s = 0;
  for (let i = 0; i < points.length; i++) {
    const v = points[i][key];
    if (v === null) continue;
    const dt = i + 1 < points.length ? Math.min(30, (points[i + 1].t - points[i].t) / 1000) : 1;
    w += dt;
    s += v * dt;
  }
  return w > 0 ? s / w : null;
}

function summarize(points: ActivityPoint[], session: Partial<ActivitySummary>): ActivitySummary {
  const cum = cumulative(points);
  const dist = cum[cum.length - 1];
  const hrs = points.map((p) => p.hr).filter((h): h is number => h !== null);
  const eles = points.map((p) => p.ele);
  const { gain } = elevationGainLoss(eles);
  return {
    startAt: session.startAt ?? new Date(points[0].t),
    distanceM: session.distanceM ?? (dist !== null && dist > 0 ? dist : null),
    durationS: session.durationS ?? (points[points.length - 1].t - points[0].t) / 1000,
    avgHr: session.avgHr ?? timeWeightedMean(points, "hr"),
    maxHr: session.maxHr ?? (hrs.length ? Math.max(...hrs) : null),
    elevationGainM: session.elevationGainM ?? (eles.some((e) => e !== null) ? gain : null),
    avgCadence: session.avgCadence ?? timeWeightedMean(points, "cad"),
    avgPower: session.avgPower ?? timeWeightedMean(points, "power"),
    hasGps: points.some((p) => p.lat !== null),
  };
}

// ─── GPX ────────────────────────────────────────────────────────────────────

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};
/** Primer valor de una etiqueta (con o sin prefijo de espacio de nombres: gpxtpx:hr, ns3:hr…). */
const tag = (body: string, name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(body)?.[1];

export function parseGpxPoints(xml: string): ActivityPoint[] {
  const out: ActivityPoint[] = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = num(/lat="([^"]+)"/.exec(m[1])?.[1]);
    const lon = num(/lon="([^"]+)"/.exec(m[1])?.[1]);
    const body = m[2];
    const time = tag(body, "time");
    const t = time ? Date.parse(time) : NaN;
    if (!Number.isFinite(t)) continue;
    const cad = num(tag(body, "cad"));
    out.push({
      t,
      lat,
      lon,
      ele: num(tag(body, "ele")),
      hr: num(tag(body, "hr")),
      // En GPX la cadencia suele ir en zancadas por minuto (un pie): × 2 = pasos/min.
      cad: cad !== null ? (cad < 120 ? cad * 2 : cad) : null,
      power: num(tag(body, "power")) ?? num(tag(body, "PowerInWatts")),
      dist: null,
    });
  }
  return out;
}

// ─── TCX ────────────────────────────────────────────────────────────────────

export function parseTcxPoints(xml: string): ActivityPoint[] {
  const out: ActivityPoint[] = [];
  const re = /<(?:\w+:)?Trackpoint\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Trackpoint>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const time = tag(body, "Time");
    const t = time ? Date.parse(time) : NaN;
    if (!Number.isFinite(t)) continue;
    const hrBlock = /<(?:\w+:)?HeartRateBpm\b[^>]*>([\s\S]*?)<\/(?:\w+:)?HeartRateBpm>/.exec(body)?.[1];
    const runCad = num(tag(body, "RunCadence"));
    const cad = num(tag(body, "Cadence"));
    const c = runCad ?? cad;
    out.push({
      t,
      lat: num(tag(body, "LatitudeDegrees")),
      lon: num(tag(body, "LongitudeDegrees")),
      ele: num(tag(body, "AltitudeMeters")),
      hr: hrBlock ? num(tag(hrBlock, "Value")) : null,
      cad: c !== null ? (c < 120 ? c * 2 : c) : null,
      power: num(tag(body, "Watts")),
      dist: num(tag(body, "DistanceMeters")),
    });
  }
  return out;
}

// ─── FIT (binario de Garmin, Coros, Strava…) ────────────────────────────────

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z
const SEMI = 180 / 2 ** 31;

interface FieldDef {
  num: number;
  size: number;
  base: number;
}
interface MsgDef {
  global: number;
  little: boolean;
  fields: FieldDef[];
  devSize: number;
}

function readField(dv: DataView, off: number, f: FieldDef, little: boolean): number | null {
  const t = f.base & 0x1f;
  switch (t) {
    case 0x00: // enum
    case 0x02: // uint8
    case 0x0a: // uint8z
    case 0x0d: {
      // byte
      const v = dv.getUint8(off);
      return v === 0xff || (t === 0x0a && v === 0) ? null : v;
    }
    case 0x01: {
      const v = dv.getInt8(off);
      return v === 0x7f ? null : v;
    }
    case 0x03: {
      if (f.size < 2) return null;
      const v = dv.getInt16(off, little);
      return v === 0x7fff ? null : v;
    }
    case 0x04:
    case 0x0b: {
      if (f.size < 2) return null;
      const v = dv.getUint16(off, little);
      return v === 0xffff || (t === 0x0b && v === 0) ? null : v;
    }
    case 0x05: {
      if (f.size < 4) return null;
      const v = dv.getInt32(off, little);
      return v === 0x7fffffff ? null : v;
    }
    case 0x06:
    case 0x0c: {
      if (f.size < 4) return null;
      const v = dv.getUint32(off, little);
      return v === 0xffffffff || (t === 0x0c && v === 0) ? null : v;
    }
    case 0x08: {
      if (f.size < 4) return null;
      const v = dv.getFloat32(off, little);
      return Number.isFinite(v) ? v : null;
    }
    case 0x09: {
      if (f.size < 8) return null;
      const v = dv.getFloat64(off, little);
      return Number.isFinite(v) ? v : null;
    }
    default:
      return null; // cadenas y enteros de 64 bits: no se usan
  }
}

export function parseFit(bytes: Uint8Array): { points: ActivityPoint[]; session: Partial<ActivitySummary> } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14) throw new ActivityFileError("El archivo .fit está vacío o dañado.");
  const headerSize = dv.getUint8(0);
  const dataSize = dv.getUint32(4, true);
  const sig = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (sig !== ".FIT") throw new ActivityFileError("No es un archivo .fit válido.");
  const end = Math.min(bytes.length, headerSize + dataSize);
  const defs = new Map<number, MsgDef>();
  const points: ActivityPoint[] = [];
  const session: Partial<ActivitySummary> = {};
  let lastTs = 0;
  let off = headerSize;

  try {
    while (off < end) {
      const h = dv.getUint8(off++);
      let local: number;
      let compressedTs: number | null = null;
      if (h & 0x80) {
        // Cabecera con marca de tiempo comprimida.
        local = (h >> 5) & 0x03;
        const offset = h & 0x1f;
        let ts = (lastTs & ~0x1f) + offset;
        if (offset < (lastTs & 0x1f)) ts += 0x20;
        compressedTs = ts;
        lastTs = ts;
      } else if (h & 0x40) {
        // Mensaje de definición.
        local = h & 0x0f;
        const hasDev = (h & 0x20) !== 0;
        const little = dv.getUint8(off + 1) === 0;
        const global = dv.getUint16(off + 2, little);
        const n = dv.getUint8(off + 4);
        off += 5;
        const fields: FieldDef[] = [];
        for (let i = 0; i < n; i++, off += 3) fields.push({ num: dv.getUint8(off), size: dv.getUint8(off + 1), base: dv.getUint8(off + 2) });
        let devSize = 0;
        if (hasDev) {
          const nd = dv.getUint8(off++);
          for (let i = 0; i < nd; i++, off += 3) devSize += dv.getUint8(off + 1);
        }
        defs.set(local, { global, little, fields, devSize });
        continue;
      } else {
        local = h & 0x0f;
      }
      const def = defs.get(local);
      if (!def) throw new ActivityFileError("El archivo .fit está dañado (mensaje sin definición).");
      const vals = new Map<number, number | null>();
      for (const f of def.fields) {
        vals.set(f.num, readField(dv, off, f, def.little));
        off += f.size;
      }
      off += def.devSize;
      const ts = vals.get(253) ?? compressedTs;
      if (vals.get(253) != null) lastTs = vals.get(253)!;

      if (def.global === 20 && ts != null) {
        // record
        const lat = vals.get(0);
        const lon = vals.get(1);
        const alt = vals.get(78) ?? vals.get(2);
        const cad = vals.get(4);
        const dist = vals.get(5);
        points.push({
          t: (ts + FIT_EPOCH_S) * 1000,
          lat: lat != null ? lat * SEMI : null,
          lon: lon != null ? lon * SEMI : null,
          ele: alt != null ? alt / 5 - 500 : null,
          hr: vals.get(3) ?? null,
          cad: cad != null ? cad * 2 : null, // zancadas/min → pasos/min
          power: vals.get(7) ?? null,
          dist: dist != null ? dist / 100 : null,
        });
      } else if (def.global === 18) {
        // session
        const st = vals.get(2);
        if (st != null) session.startAt = new Date((st + FIT_EPOCH_S) * 1000);
        const timer = vals.get(8) ?? vals.get(7);
        if (timer != null) session.durationS = timer / 1000;
        const d = vals.get(9);
        if (d != null) session.distanceM = d / 100;
        if (vals.get(16) != null) session.avgHr = vals.get(16)!;
        if (vals.get(17) != null) session.maxHr = vals.get(17)!;
        if (vals.get(22) != null) session.elevationGainM = vals.get(22)!;
        if (vals.get(18) != null) session.avgCadence = vals.get(18)! * 2;
        if (vals.get(20) != null) session.avgPower = vals.get(20)!;
      }
    }
  } catch (e) {
    if (e instanceof ActivityFileError) throw e;
    if (!points.length) throw new ActivityFileError("El archivo .fit está dañado o cortado.");
    // Archivo cortado al final: se usa lo leído.
  }
  return { points, session };
}

// ─── Series para guardar (mismo formato que el import del zip) ───────────────

export interface FileSeries {
  /** muestras de distancia por intervalo (s desde el inicio, metros del intervalo) */
  distance: { t: number[]; v: number[] } | null;
  hr: { t: number[]; v: number[] } | null;
  power: { t: number[]; v: number[] } | null;
}

/** Series relativas a `startMs`, como las del reloj: distancia por intervalos, pulso y potencia. */
export function fileSeries(points: readonly ActivityPoint[], startMs: number): FileSeries {
  const cum = cumulative(points);
  const rel = (p: ActivityPoint) => Math.round(((p.t - startMs) / 1000) * 10) / 10;
  let distance: FileSeries["distance"] = null;
  if (cum.some((d) => d !== null && d > 0)) {
    const t: number[] = [];
    const v: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const d = (cum[i] ?? 0) - (cum[i - 1] ?? 0);
      if (points[i].t <= points[i - 1].t) continue;
      t.push(rel(points[i]));
      v.push(Math.max(0, Math.round(d * 100) / 100));
    }
    distance = { t, v };
  }
  const pick = (key: "hr" | "power") => {
    const sel = points.filter((p) => p[key] !== null);
    return sel.length > 1 ? { t: sel.map(rel), v: sel.map((p) => p[key]!) } : null;
  };
  return { distance, hr: pick("hr"), power: pick("power") };
}

/** GPX mínimo (para guardar la ruta en Blob como las importadas). */
export function toGpx(points: readonly ActivityPoint[]): string {
  const pts = points
    .filter((p) => p.lat !== null && p.lon !== null)
    .map(
      (p) =>
        `<trkpt lat="${p.lat!.toFixed(7)}" lon="${p.lon!.toFixed(7)}">${p.ele !== null ? `<ele>${p.ele.toFixed(1)}</ele>` : ""}<time>${new Date(p.t).toISOString()}</time></trkpt>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Stride Lab"><trk><trkseg>\n${pts}\n</trkseg></trk></gpx>\n`;
}
