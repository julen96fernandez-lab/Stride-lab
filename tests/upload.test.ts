import { describe, expect, it, vi } from "vitest";
import {
  PART_SIZE,
  loadSaved,
  resumableUpload,
  savedBytes,
  type KeyValueStore,
  type UploadApi,
  type UploadProgress,
} from "@/lib/upload/resumable";

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function makeFile(size: number, name = "exportar.zip") {
  const f = new Blob([new Uint8Array(size)]) as Blob & { name: string; lastModified: number };
  f.name = name;
  f.lastModified = 1_700_000_000_000;
  return f;
}

/** Blob falso: guarda partes y permite fallar a partir de cierta parte. */
function fakeApi(opts: { failFromPart?: number; hangPart?: number; gone?: boolean } = {}) {
  const uploaded = new Map<number, number>();
  const calls = { create: 0, parts: [] as number[], complete: 0 };
  const api: UploadApi = {
    token: async () => "tok",
    create: async () => {
      calls.create++;
      return { key: "k", uploadId: `u${calls.create}` };
    },
    part: async ({ partNumber, body, onProgress }, signal) => {
      calls.parts.push(partNumber);
      if (opts.gone) throw new Error("NoSuchUpload: the upload does not exist");
      if (opts.hangPart === partNumber)
        await new Promise((_, rej) => signal.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))));
      if (opts.failFromPart !== undefined && partNumber >= opts.failFromPart) throw new TypeError("Load failed");
      onProgress(body.size);
      uploaded.set(partNumber, body.size);
      return { partNumber, etag: `e${partNumber}` };
    },
    complete: async ({ parts }) => {
      calls.complete++;
      return { url: "https://blob/imports/x.zip", pathname: `imports/x-${parts.length}.zip` };
    },
  };
  return { api, uploaded, calls };
}

describe("subida reanudable", () => {
  it("sube todas las partes y une", async () => {
    const file = makeFile(PART_SIZE * 2 + 1000);
    const { api, calls } = fakeApi();
    const store = memStore();
    const progress: UploadProgress[] = [];
    const res = await resumableUpload(file, { api, store, signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(res.pathname).toBe("imports/x-3.zip");
    expect(calls.parts.sort()).toEqual([1, 2, 3]);
    expect(calls.complete).toBe(1);
    expect(progress.at(-1)).toMatchObject({ phase: "done", sent: file.size, total: file.size });
    expect(loadSaved(store)).toBeNull(); // terminada: no queda nada pendiente
  });

  it("tras un corte, solo envía las partes que faltan", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const file = makeFile(PART_SIZE * 5);
    const store = memStore();
    const first = fakeApi({ failFromPart: 4 });
    await expect(
      resumableUpload(file, { api: first.api, store, signal: new AbortController().signal, onProgress: () => {} }),
    ).rejects.toThrow();
    const saved = loadSaved(store)!;
    expect(saved.parts.map((p) => p.partNumber).sort()).toEqual([1, 2, 3]);
    expect(savedBytes(saved)).toBe(PART_SIZE * 3);

    const second = fakeApi();
    const res = await resumableUpload(file, { api: second.api, store, signal: new AbortController().signal, onProgress: () => {} });
    expect(second.calls.create).toBe(0); // reutiliza el mismo uploadId
    expect(second.calls.parts.sort()).toEqual([4, 5]);
    expect(res.pathname).toBe("imports/x-5.zip");
    vi.useRealTimers();
  });

  it("si el archivo elegido es otro, empieza de cero", async () => {
    const store = memStore();
    const a = fakeApi({ failFromPart: 2 });
    await expect(
      resumableUpload(makeFile(PART_SIZE * 3), { api: a.api, store, signal: new AbortController().signal, onProgress: () => {} }),
    ).rejects.toThrow();
    const b = fakeApi();
    await resumableUpload(makeFile(PART_SIZE * 2, "otro.zip"), { api: b.api, store, signal: new AbortController().signal, onProgress: () => {} });
    expect(b.calls.create).toBe(1);
    expect(b.calls.parts.sort()).toEqual([1, 2]);
  });

  it("si Blob ya no tiene la subida a medias, la olvida", async () => {
    const store = memStore();
    const a = fakeApi({ gone: true });
    await expect(
      resumableUpload(makeFile(PART_SIZE * 2), { api: a.api, store, signal: new AbortController().signal, onProgress: () => {} }),
    ).rejects.toThrow(/NoSuchUpload/);
    expect(loadSaved(store)).toBeNull();
  });

  it("una parte colgada no espera para siempre: agota el tiempo y falla con error visible", async () => {
    vi.useFakeTimers();
    const store = memStore();
    const a = fakeApi({ hangPart: 1 });
    const p = resumableUpload(makeFile(1000), { api: a.api, store, signal: new AbortController().signal, onProgress: () => {} });
    const outcome = p.then(
      () => "ok",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await outcome).toMatch(/Tiempo de espera|abort/i);
    expect(a.calls.parts).toEqual([1, 1, 1]); // 3 intentos, no infinitos
    vi.useRealTimers();
  });
});
