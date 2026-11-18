"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { db } from "@/lib/db/client";
import { putPrivate } from "@/lib/import/blob";
import { ActivityFileError } from "@/lib/import/activity-file";
import { parseManualForm, type ManualErrors } from "@/lib/manual/manual";
import { deleteManualRun, previewManual, saveManualRun, type ManualPreview } from "@/lib/manual/manual-db";

export type ManualState = {
  errors?: ManualErrors;
  /** Error general (archivo, servidor…). */
  error?: string;
  preview?: ManualPreview;
  /** Hay carreras a ≤ 30 min: hace falta confirmar para guardar. */
  needsConfirm?: boolean;
};

const MAX_FILE = 4 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

function fields(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function readFile(fd: FormData): Promise<{ name: string; bytes: Uint8Array } | null | "too-big"> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_FILE) return "too-big";
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

/** Vista previa y guardado en una sola acción: `intent` = "preview" | "save". */
export async function manualRunAction(_prev: ManualState, fd: FormData): Promise<ManualState> {
  const { input, errors } = parseManualForm(fields(fd));
  const id = String(fd.get("id") ?? "").trim() || null;
  if (id && !UUID.test(id)) return { error: "Carrera no válida." };
  if (!input) return { errors };
  const file = await readFile(fd);
  if (file === "too-big") return { errors: { file: "El archivo pasa de 4 MB. Expórtalo sin fotos o en .fit, que ocupa menos." } };

  let preview: ManualPreview;
  try {
    preview = await previewManual(db(), input, file, id);
  } catch (e) {
    if (e instanceof ActivityFileError) return { errors: { file: e.message } };
    throw e;
  }
  if (fd.get("intent") !== "save") return { preview };
  if (preview.duplicates.length && fd.get("confirm") !== "1") return { preview, needsConfirm: true };

  let saved: string;
  try {
    saved = await saveManualRun({ db: db(), putRoute: (p, body) => putPrivate(p, body, "application/gpx+xml") }, input, {
      id,
      file,
      removeFile: fd.get("removeFile") === "on",
    });
  } catch (e) {
    if (e instanceof ActivityFileError) return { errors: { file: e.message } };
    return { error: e instanceof Error ? e.message : "No se pudo guardar la carrera." };
  }
  refresh();
  redirect(`/actividad/${saved}`);
}

export async function deleteManualAction(id: string): Promise<{ ok: boolean }> {
  if (!UUID.test(id)) return { ok: false };
  const ok = await deleteManualRun(db(), id);
  if (ok) {
    refresh();
    redirect("/actividad");
  }
  return { ok };
}
