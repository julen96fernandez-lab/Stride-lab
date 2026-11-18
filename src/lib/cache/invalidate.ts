import "server-only";
import { revalidateTag, updateTag } from "next/cache";
import { DATA_TAG } from "./tags";
import { forgetClassified } from "@/lib/analysis/session-type-db";

/** En una acción de servidor: la siguiente lectura ya ve el cambio (lee-lo-que-escribes). */
export function dataChanged() {
  forgetClassified();
  updateTag(DATA_TAG);
}

/** En una ruta (importación): caduca ya, sin servir datos viejos. */
export function dataChangedInRoute() {
  forgetClassified();
  revalidateTag(DATA_TAG, { expire: 0 });
}
