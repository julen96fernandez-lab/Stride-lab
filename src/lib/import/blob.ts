import "server-only";
import { get, head, put } from "@vercel/blob";
import type { RangeSource } from "./zip";

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

/** Lee el zip privado de Vercel Blob por rangos de bytes (peticiones Range). */
export function blobRangeSource(url: string): RangeSource {
  let size: number | undefined;

  const ranged = async (start: number, end: number) => {
    const res = await get(url, {
      access: "private",
      useCache: false,
      headers: { Range: `bytes=${start}-${end - 1}` },
    });
    if (!res || res.statusCode !== 200) throw new Error("No se pudo leer el zip de Blob");
    const partial = res.headers.get("content-range");
    if (!partial && !(start === 0 && end === size)) {
      await res.stream.cancel();
      throw new Error("Vercel Blob no devolvió una lectura parcial (Range)");
    }
    return res.stream;
  };

  return {
    async size() {
      if (size === undefined) size = (await withRetry(() => head(url))).size;
      return size;
    },
    read: (start, end) =>
      withRetry(async () => Buffer.from(await new Response(await ranged(start, end)).arrayBuffer())),
    stream: (start, end) => withRetry(() => ranged(start, end)),
  };
}

export async function putPrivate(pathname: string, body: Buffer, contentType: string): Promise<string> {
  const res = await withRetry(() =>
    put(pathname, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType }),
  );
  return res.url;
}
