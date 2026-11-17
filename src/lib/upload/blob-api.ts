"use client";

import { completeMultipartUpload, createMultipartUpload, uploadPart } from "@vercel/blob/client";
import type { UploadApi } from "./resumable";

const CT = "application/zip";

/** Implementación real de UploadApi: token desde la app, partes directas a Blob. */
export const blobUploadApi: UploadApi = {
  async token(pathname) {
    const res = await fetch("/api/import/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname }),
    });
    if (res.status === 401) throw new Error("La sesión ha caducado: vuelve a entrar");
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sin permiso de subida");
    return ((await res.json()) as { token: string }).token;
  },
  create: (pathname, token, signal) =>
    createMultipartUpload(pathname, { access: "private", token, contentType: CT, abortSignal: signal }),
  part: ({ pathname, token, key, uploadId, partNumber, body, onProgress }, signal) =>
    uploadPart(pathname, body, {
      access: "private",
      token,
      key,
      uploadId,
      partNumber,
      contentType: CT,
      abortSignal: signal,
      onUploadProgress: (p) => onProgress(p.loaded),
    }),
  complete: ({ pathname, token, key, uploadId, parts }, signal) =>
    completeMultipartUpload(pathname, parts, { access: "private", token, key, uploadId, contentType: CT, abortSignal: signal }),
};
