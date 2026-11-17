import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isUploadPathname } from "@/lib/import/register";

/**
 * Token de cliente para la subida por partes (reanudable) directa del navegador a
 * Vercel Blob. No hay callback de Blob hacia la app: al terminar, el propio navegador
 * llama a POST /api/import. Ruta protegida por sesión (proxy).
 */
export async function POST(request: Request) {
  const { pathname } = (await request.json().catch(() => ({}))) as { pathname?: string };
  if (!pathname || !isUploadPathname(pathname)) {
    return NextResponse.json({ error: "Ruta de subida no permitida" }, { status: 400 });
  }
  const validUntil = Date.now() + 3 * 60 * 60 * 1000; // 3 h; el navegador pide otro si caduca
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
    maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil,
  });
  return NextResponse.json({ token, validUntil });
}
