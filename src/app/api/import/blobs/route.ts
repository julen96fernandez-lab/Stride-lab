import { list } from "@vercel/blob";
import { connection, NextResponse } from "next/server";
import { db, schema as s } from "@/lib/db/client";

export type StoredZip = {
  pathname: string;
  size: number;
  uploadedAt: string;
  /** Estado de la última importación de este zip, si la hay. */
  importStatus: string | null;
  importId: string | null;
};

/** Zips que ya están en Blob (para crear la importación sin volver a subirlos). */
export async function GET() {
  await connection();
  const blobs: { pathname: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "imports/", cursor, limit: 100 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const imports = await db()
    .select({ id: s.imports.id, pathname: s.imports.blobPathname, status: s.imports.status, createdAt: s.imports.createdAt })
    .from(s.imports);
  const latest = new Map<string, (typeof imports)[number]>();
  for (const i of imports) {
    const prev = latest.get(i.pathname);
    if (!prev || prev.createdAt < i.createdAt) latest.set(i.pathname, i);
  }

  const zips: StoredZip[] = blobs
    .filter((b) => b.pathname.toLowerCase().endsWith(".zip"))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .map((b) => ({
      pathname: b.pathname,
      size: b.size,
      uploadedAt: b.uploadedAt.toISOString(),
      importStatus: latest.get(b.pathname)?.status ?? null,
      importId: latest.get(b.pathname)?.id ?? null,
    }));
  return NextResponse.json({ zips });
}
