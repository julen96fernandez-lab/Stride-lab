/**
 * Subida por partes reanudable a Vercel Blob.
 *
 * - Guarda en el dispositivo (localStorage) el uploadId, la clave y las partes ya
 *   confirmadas. Si la subida se corta, al elegir de nuevo el mismo archivo solo se
 *   envían las partes que faltan.
 * - Cada petición tiene un tiempo máximo y pocos reintentos visibles: nunca se queda
 *   esperando en silencio.
 * - Al terminar NO depende de ningún callback de Blob: devuelve el resultado y quien
 *   llama crea la importación.
 */

export const PART_SIZE = 8 * 1024 * 1024; // mínimo de Blob: 5 MB
const CONCURRENCY = 3;
const PART_TIMEOUT_MS = 120_000;
const COMPLETE_TIMEOUT_MS = 180_000;
const ATTEMPTS = 3;
const STORAGE_KEY = "stride.upload.v1";

export interface SavedUpload {
  v: 1;
  pathname: string;
  key: string;
  uploadId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  partSize: number;
  parts: { partNumber: number; etag: string }[];
  startedAt: number;
}

export type UploadPhase = "preparing" | "uploading" | "joining" | "done";

export interface UploadProgress {
  phase: UploadPhase;
  sent: number;
  total: number;
  partsDone: number;
  partsTotal: number;
  /** Mensaje si se está reintentando una petición. */
  retrying?: string;
}

export interface UploadApi {
  token(pathname: string): Promise<string>;
  create(pathname: string, token: string, signal: AbortSignal): Promise<{ key: string; uploadId: string }>;
  part(
    args: {
      pathname: string;
      token: string;
      key: string;
      uploadId: string;
      partNumber: number;
      body: Blob;
      onProgress: (loaded: number) => void;
    },
    signal: AbortSignal,
  ): Promise<{ etag: string; partNumber: number }>;
  complete(
    args: { pathname: string; token: string; key: string; uploadId: string; parts: { partNumber: number; etag: string }[] },
    signal: AbortSignal,
  ): Promise<{ url: string; pathname: string }>;
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function loadSaved(store: KeyValueStore | null): SavedUpload | null {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedUpload;
    return s?.v === 1 && s.uploadId && Array.isArray(s.parts) ? s : null;
  } catch {
    return null;
  }
}

function save(store: KeyValueStore | null, s: SavedUpload) {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: la subida funciona, pero no se podrá reanudar */
  }
}

export function clearSaved(store: KeyValueStore | null) {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* nada */
  }
}

export function sameFile(s: SavedUpload, f: { name: string; size: number; lastModified: number }): boolean {
  return s.fileName === f.name && s.fileSize === f.size && s.lastModified === f.lastModified;
}

export function savedBytes(s: SavedUpload): number {
  const n = Math.ceil(s.fileSize / s.partSize);
  return s.parts.reduce((acc, p) => acc + (p.partNumber === n ? s.fileSize - (n - 1) * s.partSize : s.partSize), 0);
}

/** Error que indica que el uploadId ya no existe en Blob: hay que empezar de cero. */
export function isGoneError(err: unknown): boolean {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /not.?found|no such upload|NoSuchUpload|does not exist|404/i.test(m);
}

/** Combina la señal externa con un tiempo máximo. */
function timeoutSignal(outer: AbortSignal, ms: number): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort(outer.reason);
  if (outer.aborted) ctrl.abort(outer.reason);
  else outer.addEventListener("abort", onAbort, { once: true });
  const t = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new Error("Tiempo de espera agotado"));
  }, ms);
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(t);
      outer.removeEventListener("abort", onAbort);
    },
  };
}

async function withAttempts<T>(
  label: string,
  outer: AbortSignal,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
  onRetry: (msg: string | undefined) => void,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= ATTEMPTS; i++) {
    if (outer.aborted) throw outer.reason ?? new Error("Cancelado");
    const { signal, timedOut, done } = timeoutSignal(outer, timeoutMs);
    try {
      const r = await fn(signal);
      onRetry(undefined);
      return r;
    } catch (err) {
      last = timedOut() ? new Error(`${label}: sin respuesta en ${Math.round(timeoutMs / 1000)} s (tiempo de espera agotado)`) : err;
      if (outer.aborted || isGoneError(last)) throw last;
      onRetry(`${label}: reintento ${i} de ${ATTEMPTS - 1}`);
      if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * i));
    } finally {
      done();
    }
  }
  throw last;
}

export interface UploadOptions {
  api: UploadApi;
  store: KeyValueStore | null;
  signal: AbortSignal;
  onProgress: (p: UploadProgress) => void;
  newPathname?: () => string;
}

export async function resumableUpload(
  file: Blob & { name: string; lastModified: number },
  opts: UploadOptions,
): Promise<{ url: string; pathname: string }> {
  const { api, store, signal, onProgress } = opts;
  const total = file.size;
  let retrying: string | undefined;

  let saved = loadSaved(store);
  if (saved && !sameFile(saved, file)) saved = null; // otro archivo: se empieza de cero

  const partsTotal = Math.max(1, Math.ceil(total / (saved?.partSize ?? PART_SIZE)));
  const emit = (phase: UploadPhase, sent: number, partsDone: number) =>
    onProgress({ phase, sent: Math.min(sent, total), total, partsDone, partsTotal, retrying });
  const setRetry = (m: string | undefined) => {
    retrying = m;
  };

  emit("preparing", saved ? savedBytes(saved) : 0, saved?.parts.length ?? 0);
  let pathname = saved?.pathname ?? opts.newPathname?.() ?? `imports/${crypto.randomUUID()}.zip`;
  let token = await withAttempts("Permiso de subida", signal, 30_000, () => api.token(pathname), setRetry);

  if (!saved) {
    const { key, uploadId } = await withAttempts("Inicio", signal, 60_000, (sg) => api.create(pathname, token, sg), setRetry);
    saved = {
      v: 1,
      pathname,
      key,
      uploadId,
      fileName: file.name,
      fileSize: total,
      lastModified: file.lastModified,
      partSize: PART_SIZE,
      parts: [],
      startedAt: Date.now(),
    };
    save(store, saved);
  }
  const state = saved;
  pathname = state.pathname;

  const done = new Map(state.parts.map((p) => [p.partNumber, p.etag]));
  const inflight = new Map<number, number>();
  const sentBytes = () => savedBytes({ ...state, parts: [...done].map(([partNumber, etag]) => ({ partNumber, etag })) }) +
    [...inflight.values()].reduce((a, b) => a + b, 0);
  const report = () => emit("uploading", sentBytes(), done.size);
  report();

  const queue: number[] = [];
  for (let n = 1; n <= partsTotal; n++) if (!done.has(n)) queue.push(n);

  try {
    const worker = async () => {
      for (;;) {
        const partNumber = queue.shift();
        if (partNumber === undefined) return;
        const start = (partNumber - 1) * state.partSize;
        const body = file.slice(start, Math.min(total, start + state.partSize));
        const res = await withAttempts(
          `Parte ${partNumber}`,
          signal,
          PART_TIMEOUT_MS,
          (sg) => {
            inflight.set(partNumber, 0);
            return api.part(
              {
                pathname,
                token,
                key: state.key,
                uploadId: state.uploadId,
                partNumber,
                body,
                onProgress: (loaded) => {
                  inflight.set(partNumber, Math.min(loaded, body.size));
                  report();
                },
              },
              sg,
            );
          },
          (m) => {
            setRetry(m);
            report();
          },
        );
        inflight.delete(partNumber);
        done.set(partNumber, res.etag);
        state.parts = [...done].map(([n, etag]) => ({ partNumber: n, etag }));
        save(store, state);
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } catch (err) {
    if (isGoneError(err)) clearSaved(store); // la subida a medias ya no existe en Blob
    throw err;
  }

  emit("joining", total, done.size);
  // El token pudo caducar en una subida larga: se pide uno nuevo para cerrar.
  token = await withAttempts("Permiso de subida", signal, 30_000, () => api.token(pathname), setRetry);
  const parts = [...done].map(([partNumber, etag]) => ({ partNumber, etag })).sort((a, b) => a.partNumber - b.partNumber);
  let result: { url: string; pathname: string };
  try {
    result = await withAttempts(
      "Unión de partes",
      signal,
      COMPLETE_TIMEOUT_MS,
      (sg) => api.complete({ pathname, token, key: state.key, uploadId: state.uploadId, parts }, sg),
      (m) => {
        setRetry(m);
        emit("joining", total, done.size);
      },
    );
  } catch (err) {
    if (isGoneError(err)) clearSaved(store);
    throw err;
  }
  clearSaved(store);
  emit("done", total, done.size);
  return result;
}
