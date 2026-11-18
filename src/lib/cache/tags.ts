/**
 * Caché de las pantallas: una etiqueta para todos los datos. Cualquier cambio (importar,
 * reprocesar, guardar, editar o borrar una carrera, cambiar zonas, tipos, objetivos o
 * lesiones) la invalida, y la siguiente visita lee de la base de datos.
 */
export const DATA_TAG = "datos";

/** Vida de las entradas: el cliente puede reutilizar 5 min; el servidor revalida a los 15 min y
 * caduca en un día (y la fecha de hoy va en la clave, así que al cambiar de día se recalcula). */
export const DATA_LIFE = { stale: 300, revalidate: 900, expire: 86_400 } as const;

/** Día de hoy en Madrid (AAAA-MM-DD): parte de la clave de caché de cada pantalla. */
export function cacheDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
