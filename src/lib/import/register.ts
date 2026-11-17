import { and, desc, eq, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

/** Rutas que genera el navegador para las subidas: imports/<uuid>.zip */
export function isUploadPathname(p: string): boolean {
  return /^imports\/[0-9a-f-]{36}\.zip$/i.test(p) || /^imports\/[\w.\-]+\.zip$/i.test(p);
}

export interface BlobInfo {
  url: string;
  pathname: string;
  size: number;
}

/**
 * Crea (o recupera) la importación de un zip que ya está en Blob.
 * Si ya hay una importación sin terminar de ese mismo zip, la devuelve para
 * continuarla en vez de empezar otra.
 */
export async function registerImportFromBlob(
  db: Db,
  blob: BlobInfo,
  fileName: string | null,
): Promise<{ row: typeof s.imports.$inferSelect; reused: boolean }> {
  const open = await db
    .select()
    .from(s.imports)
    .where(and(eq(s.imports.blobPathname, blob.pathname), ne(s.imports.status, "done")))
    .orderBy(desc(s.imports.createdAt))
    .limit(1);
  if (open[0]) return { row: open[0], reused: true };
  const [row] = await db
    .insert(s.imports)
    .values({ blobUrl: blob.url, blobPathname: blob.pathname, fileName: fileName?.slice(0, 200) ?? null, fileSize: blob.size })
    .returning();
  return { row, reused: false };
}
