import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/lib/db/client";
import { toView } from "@/lib/import/status";

/** Registra un zip ya subido a Blob y crea la importación. */
export async function POST(request: Request) {
  const { url, pathname, fileName } = (await request.json()) as { url?: string; pathname?: string; fileName?: string };
  if (!url || !pathname || !pathname.startsWith("imports/")) {
    return NextResponse.json({ error: "Datos de subida incompletos" }, { status: 400 });
  }
  let size: number;
  try {
    const meta = await head(url);
    if (meta.pathname !== pathname) throw new Error("La ruta no coincide");
    size = meta.size;
  } catch {
    return NextResponse.json({ error: "No encuentro el archivo subido en Blob" }, { status: 400 });
  }
  const [row] = await db()
    .insert(s.imports)
    .values({ blobUrl: url, blobPathname: pathname, fileName: fileName?.slice(0, 200) ?? null, fileSize: size })
    .returning();
  return NextResponse.json(toView(row));
}
