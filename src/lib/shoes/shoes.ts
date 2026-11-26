/**
 * Garaje de zapatillas: validación del formulario, km acumulados y uso frente al límite. Lógica
 * pura, con pruebas.
 *
 * - Km = km iniciales + carreras válidas asignadas (las duplicadas y no válidas no suman).
 * - Las carreras en cinta suman solo si la zapatilla tiene «Contar carreras en cinta».
 * - Aviso suave desde el 80 % del límite (sin notificaciones: solo se ve en pantalla).
 */
export const SHOE_RULES = {
  defaultLimitKm: 700,
  warnPct: 0.8,
  maxName: 60,
  maxText: 60,
  maxKm: 10_000,
} as const;

export interface ShoeInput {
  name: string;
  brand: string | null;
  model: string | null;
  purchasedAt: string | null;
  initialKm: number;
  limitKm: number;
  countTreadmill: boolean;
  isDefault: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: string) => YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null | "bad" => {
  const t = text(v).replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "bad";
};
const on = (v: unknown) => v === true || v === "on" || v === "true" || v === "1";

/** Formulario de zapatilla → datos o un error claro. */
export function parseShoe(raw: Record<string, unknown>, today: string): { shoe: ShoeInput } | { error: string } {
  const R = SHOE_RULES;
  const name = text(raw.name);
  if (!name) return { error: "Pon un nombre a la zapatilla." };
  if (name.length > R.maxName) return { error: `El nombre admite hasta ${R.maxName} caracteres.` };
  const brand = text(raw.brand) || null;
  const model = text(raw.model) || null;
  if ((brand?.length ?? 0) > R.maxText || (model?.length ?? 0) > R.maxText) return { error: `Marca y modelo admiten hasta ${R.maxText} caracteres.` };
  const purchasedAt = text(raw.purchasedAt) || null;
  if (purchasedAt && !isYmd(purchasedAt)) return { error: "Fecha de compra no válida." };
  if (purchasedAt && purchasedAt > today) return { error: "La fecha de compra no puede ser futura." };
  const initial = num(raw.initialKm);
  if (initial === "bad" || (initial !== null && (initial < 0 || initial > R.maxKm))) return { error: "Los km iniciales van de 0 a 10.000." };
  const limit = num(raw.limitKm);
  if (limit === "bad" || (limit !== null && (limit < 50 || limit > R.maxKm))) return { error: "El límite va de 50 a 10.000 km." };
  return {
    shoe: {
      name,
      brand,
      model,
      purchasedAt,
      initialKm: initial ?? 0,
      limitKm: limit ?? R.defaultLimitKm,
      // Sin casilla en el formulario = activado (por defecto).
      countTreadmill: raw.countTreadmill === undefined ? true : on(raw.countTreadmill),
      isDefault: on(raw.isDefault),
    },
  };
}

export interface ShoeRun {
  distanceM: number | null;
  status: string;
  isIndoor: boolean | null;
}

/** ¿Suma esta carrera a la zapatilla? */
export function countsFor(run: ShoeRun, countTreadmill: boolean): boolean {
  if (run.status !== "valid" || !run.distanceM) return false;
  return countTreadmill || run.isIndoor !== true;
}

/** Km acumulados: iniciales + carreras válidas asignadas (sin cinta si así se elige). */
export function shoeKm(shoe: { initialKm: number; countTreadmill: boolean }, runs: readonly ShoeRun[]): { km: number; runs: number } {
  const used = runs.filter((r) => countsFor(r, shoe.countTreadmill));
  return { km: shoe.initialKm + used.reduce((a, r) => a + r.distanceM!, 0) / 1000, runs: used.length };
}

export interface ShoeUsage {
  /** 0…∞ (1 = en el límite) */
  pct: number;
  /** desde el 80 % */
  warn: boolean;
  over: boolean;
  leftKm: number;
  message: string | null;
}

const km0 = (x: number) => Math.round(x).toLocaleString("es-ES");

/** Uso frente al límite, con el aviso suave desde el 80 %. */
export function shoeUsage(km: number, limitKm: number): ShoeUsage {
  const pct = limitKm > 0 ? km / limitKm : 0;
  const over = km >= limitKm;
  const warn = pct >= SHOE_RULES.warnPct;
  const leftKm = Math.max(0, limitKm - km);
  const message = over
    ? `Ha llegado a su límite de ${km0(limitKm)} km.`
    : warn
      ? `Está al ${Math.round(pct * 100)} % de su límite: quedan unos ${km0(leftKm)} km.`
      : null;
  return { pct, warn, over, leftKm, message };
}

/** Rango de la asignación masiva (fechas incluidas). */
export function parseRange(raw: Record<string, unknown>): { from: string; to: string } | { error: string } {
  const from = text(raw.from);
  const to = text(raw.to);
  if (!isYmd(from) || !isYmd(to)) return { error: "Elige las dos fechas." };
  if (from > to) return { error: "La fecha inicial va antes que la final." };
  return { from, to };
}

/** Nombre a mostrar: «Nombre (Marca Modelo)». */
export function shoeLabel(s: { name: string; brand: string | null; model: string | null }): string {
  const extra = [s.brand, s.model].filter(Boolean).join(" ");
  return extra && extra !== s.name ? `${s.name} (${extra})` : s.name;
}
