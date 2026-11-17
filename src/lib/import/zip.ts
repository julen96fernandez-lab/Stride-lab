/**
 * Lector de zip por rangos de bytes: lee el directorio central y extrae entradas
 * concretas sin descargar el archivo completo. Soporta Zip64.
 */
import { Readable } from "node:stream";
import { createInflateRaw, inflateRawSync } from "node:zlib";

/** Origen de bytes con acceso aleatorio (Vercel Blob, archivo local…). */
export interface RangeSource {
  size(): Promise<number>;
  /** Bytes [start, end) completos en memoria (para trozos pequeños). */
  read(start: number, end: number): Promise<Buffer>;
  /** Stream de bytes [start, end). */
  stream(start: number, end: number): Promise<ReadableStream<Uint8Array>>;
}

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const MAX = 0xffffffff;

function readU64(b: Buffer, o: number): number {
  const v = b.readBigUInt64LE(o);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Zip demasiado grande");
  return Number(v);
}

export async function readCentralDirectory(src: RangeSource): Promise<ZipEntry[]> {
  const size = await src.size();
  const tailLen = Math.min(size, 22 + 0xffff + 20);
  const tail = await src.read(size - tailLen, size);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("No es un zip válido (falta el directorio central)");

  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);

  const loc = eocd - 20;
  if (loc >= 0 && tail.readUInt32LE(loc) === SIG_Z64_LOCATOR) {
    const z64Offset = readU64(tail, loc + 8);
    const z64 = await src.read(z64Offset, z64Offset + 56);
    if (z64.readUInt32LE(0) !== SIG_Z64_EOCD) throw new Error("Zip64 corrupto");
    count = readU64(z64, 32);
    cdSize = readU64(z64, 40);
    cdOffset = readU64(z64, 48);
  }

  const cd = await src.read(cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.readUInt32LE(p) !== SIG_CEN) throw new Error("Directorio central corrupto");
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let localHeaderOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);

    // Campo extra Zip64 (id 0x0001): solo trae los valores que valen 0xFFFFFFFF.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === MAX) {
          uncompressedSize = readU64(cd, q);
          q += 8;
        }
        if (compressedSize === MAX) {
          compressedSize = readU64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === MAX) localHeaderOffset = readU64(cd, q);
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p = eEnd + commentLen;
  }
  return entries;
}

/** Offset donde empiezan los datos comprimidos de una entrada. */
export async function entryDataStart(src: RangeSource, entry: ZipEntry): Promise<number> {
  const h = await src.read(entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (h.readUInt32LE(0) !== SIG_LOC) throw new Error(`Cabecera local corrupta: ${entry.name}`);
  return entry.localHeaderOffset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
}

/** Entrada pequeña completa (GPX): una sola petición con holgura para la cabecera local. */
export async function readSmallEntry(src: RangeSource, entry: ZipEntry): Promise<Buffer> {
  const slack = 30 + 1024 + entry.name.length * 2;
  const end = Math.min(await src.size(), entry.localHeaderOffset + slack + entry.compressedSize);
  const buf = await src.read(entry.localHeaderOffset, end);
  if (buf.readUInt32LE(0) !== SIG_LOC) throw new Error(`Cabecera local corrupta: ${entry.name}`);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  let data = buf.subarray(start, start + entry.compressedSize);
  if (data.length < entry.compressedSize) {
    const s = entry.localHeaderOffset + start;
    data = await src.read(s, s + entry.compressedSize);
  }
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Compresión no soportada (${entry.method}) en ${entry.name}`);
}

/** Stream de la entrada descomprimida (Node Readable). */
export async function openEntryStream(src: RangeSource, entry: ZipEntry, dataStart?: number): Promise<Readable> {
  const start = dataStart ?? (await entryDataStart(src, entry));
  const web = await src.stream(start, start + entry.compressedSize);
  const raw = Readable.fromWeb(web as Parameters<typeof Readable.fromWeb>[0]);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`Compresión no soportada (${entry.method}) en ${entry.name}`);
  const inflate = createInflateRaw({ chunkSize: 256 * 1024 });
  raw.on("error", (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}

/** Origen en memoria (pruebas y scripts locales). */
export function bufferSource(buf: Buffer): RangeSource {
  return {
    size: async () => buf.length,
    read: async (s, e) => buf.subarray(s, e),
    stream: async (s, e) => {
      const slice = buf.subarray(s, e);
      let i = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i >= slice.length) return controller.close();
          const n = Math.min(64 * 1024, slice.length - i);
          controller.enqueue(new Uint8Array(slice.subarray(i, i + n)));
          i += n;
        },
      });
    },
  };
}
