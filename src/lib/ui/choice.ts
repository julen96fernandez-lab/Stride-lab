/**
 * Selectores con estado en el cliente: el valor elegido vive en la página (cambio instantáneo)
 * y se refleja en la URL (recargar o volver atrás lo conserva). Lógica pura, con pruebas.
 */
export type Choices = Record<string, string>;

/** Valores iniciales desde los parámetros de la URL; lo que no sea una opción válida → por defecto. */
export function choicesFromParams(
  params: Record<string, string | string[] | undefined>,
  spec: Record<string, { default: string; options: readonly string[] }>,
): Choices {
  const out: Choices = {};
  for (const [name, { default: d, options }] of Object.entries(spec)) {
    const v = params[name];
    out[name] = typeof v === "string" && options.includes(v) ? v : d;
  }
  return out;
}

/** URL con los valores elegidos; los que valen lo de por defecto no se escriben. Conserva lo demás. */
export function choiceUrl(href: string, values: Choices, defaults: Choices): string {
  const url = new URL(href, "http://x");
  for (const [name, v] of Object.entries(values)) {
    if (v === defaults[name]) url.searchParams.delete(name);
    else url.searchParams.set(name, v);
  }
  const qs = url.searchParams.toString();
  return url.pathname + (qs ? `?${qs}` : "") + url.hash;
}

/** ¿Se cumple la condición de un panel? (todas las claves deben coincidir) */
export function choiceMatches(values: Choices, when: Choices): boolean {
  return Object.entries(when).every(([k, v]) => values[k] === v);
}
