import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { isUploadPathname, registerImportFromBlob } from "@/lib/import/register";
import { toView } from "@/lib/import/status";

/**
 * Crea la importación a partir de un zip que YA está en Blob (recién subido o de
 * una subida anterior). Lo llama el navegador; no depende de ningún callback.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { pathname?: string; fileName?: string; size?: number };
  const pathname = body.pathname;
  if (!pathname || !isUploadPathname(pathname)) {
    return NextResponse.json({ error: "Ruta de zip no válida" }, { status: 400 });
  }
  let meta: Awaited<ReturnType<typeof head>>;
  try {
    meta = await Promise.race([
      head(pathname, { abortSignal: AbortSignal.timeout(20_000) }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 25_000)),
    ]);
  } catch {
    return NextResponse.json({ error: "Ese zip no está en el almacenamiento" }, { status: 404 });
  }
  if (typeof body.size === "number" && body.size !== meta.size) {
    return NextResponse.json(
      { error: `El zip guardado mide ${meta.size} bytes y el elegido ${body.size}: no coinciden` },
      { status: 409 },
    );
  }
  const { row, reused } = await registerImportFromBlob(
    db(),
    { url: meta.url, pathname: meta.pathname, size: meta.size },
    body.fileName ?? null,
  );
  return NextResponse.json({ ...toView(row), reused });
}
