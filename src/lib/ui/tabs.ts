/**
 * Toque en una pestaña: si ya estás exactamente en ella, solo sube arriba; si no, navega
 * (y al llegar, la página empieza arriba).
 */
export function tabNavigation(pathname: string, href: string): "top" | "navigate" {
  return pathname === href ? "top" : "navigate";
}

/** Refresco por detrás al volver a una pestaña: solo si lo guardado tiene más de un minuto. */
export const REFRESH_AFTER_MS = 60_000;
export function shouldRefresh(lastSeen: number | undefined, now: number): boolean {
  return lastSeen !== undefined && now - lastSeen > REFRESH_AFTER_MS;
}
