/** Conversión de las unidades que usa Apple Health a las del esquema. null = no convertible. */

const num = (v: string | number | undefined | null): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function toMeters(value: string | number | undefined, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null) return null;
  switch ((unit ?? "").toLowerCase()) {
    case "km":
      return n * 1000;
    case "m":
      return n;
    case "cm":
      return n / 100;
    case "mi":
      return n * 1609.344;
    case "ft":
      return n * 0.3048;
    case "yd":
      return n * 0.9144;
    default:
      return null;
  }
}

export function toSeconds(value: string | number | undefined, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null) return null;
  switch ((unit ?? "min").toLowerCase()) {
    case "min":
      return n * 60;
    case "s":
    case "sec":
      return n;
    case "hr":
    case "h":
      return n * 3600;
    case "ms":
      return n / 1000;
    default:
      return null;
  }
}

export function toMs(value: string | number | undefined, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null) return null;
  switch ((unit ?? "ms").toLowerCase()) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    default:
      return null;
  }
}

export function toCm(value: string | number | undefined, unit: string | undefined): number | null {
  const m = toMeters(value, unit);
  return m === null ? null : m * 100;
}

export function toMps(value: string | number | undefined, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null) return null;
  switch ((unit ?? "").toLowerCase()) {
    case "m/s":
      return n;
    case "km/hr":
    case "km/h":
      return n / 3.6;
    case "mi/hr":
    case "mph":
      return n * 0.44704;
    default:
      return null;
  }
}

export function toKcal(value: string | number | undefined, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null) return null;
  switch ((unit ?? "kcal").toLowerCase()) {
    case "kcal":
    case "cal": // Apple usa "Cal" como kilocaloría
      return n;
    case "kj":
      return n / 4.184;
    default:
      return null;
  }
}

/** Valor de metadato con unidad: "12345 cm", "61.2 degF", "7200 %". */
export function splitQuantity(s: string | undefined): { value: number; unit: string } | null {
  if (!s) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.*?)\s*$/i.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: m[2] } : null;
}

export function temperatureC(s: string | undefined): number | null {
  const q = splitQuantity(s);
  if (!q) return null;
  const u = q.unit.toLowerCase();
  if (u === "degf") return ((q.value - 32) * 5) / 9;
  if (u === "degc" || u === "") return q.value;
  if (u === "k") return q.value - 273.15;
  return null;
}

/** Apple guarda la humedad como «porcentaje × 100» ("7200 %" = 72 %). */
export function humidityPct(s: string | undefined): number | null {
  const q = splitQuantity(s);
  if (!q) return null;
  const v = q.value > 100 ? q.value / 100 : q.value;
  return v >= 0 && v <= 100 ? v : null;
}

export function elevationM(s: string | undefined): number | null {
  const q = splitQuantity(s);
  if (!q) return null;
  return toMeters(q.value, q.unit || "m");
}

export function bool01(s: string | undefined): boolean | null {
  if (s === undefined) return null;
  const t = s.trim().toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t === "0" || t === "false") return false;
  return null;
}

export { num as toNumber };
