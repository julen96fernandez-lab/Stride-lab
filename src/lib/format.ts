/** Formato es-ES. Todo devuelve «—» si el dato falta: nunca se inventa. */

export const DASH = "—";
export const TZ = "Europe/Madrid";

export function km(m: number | null | undefined, digits = 2): string {
  if (m === null || m === undefined) return DASH;
  return (m / 1000).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 6101 → "1:41:41"; 2700 → "45:00". */
export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined) return DASH;
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** s/km → "4:46". */
export function pace(sPerKm: number | null | undefined): string {
  if (sPerKm === null || sPerKm === undefined || !Number.isFinite(sPerKm)) return DASH;
  const t = Math.round(sPerKm);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  return Math.round(n).toLocaleString("es-ES");
}

export function dec(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return DASH;
  return n.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  if (n >= 2 ** 30) return `${dec(n / 2 ** 30, 2)} GB`;
  if (n >= 2 ** 20) return `${dec(n / 2 ** 20, 0)} MB`;
  return `${dec(n / 1024, 0)} KB`;
}

export function date(iso: string | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: TZ, ...opts }).format(new Date(iso)).replace(".", "");
}

/** Primera letra en mayúscula ("sábado, 17 de octubre" → "Sábado, 17 de octubre"). */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
