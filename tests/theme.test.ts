/**
 * Contraste WCAG de los dos temas, leído de globals.css (fuente de verdad).
 * Texto ≥ 4,5:1; elementos gráficos (líneas, iconos, rutas, zonas, carga, tipos) ≥ 3:1.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const THEMES = { noche: block(":root {"), día: block(':root[data-theme="light"] {') };

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function lum([r, g, b]: [number, number, number]) {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT: [string, string][] = [
  ["fg", "bg"],
  ["fg", "card"],
  ["fg-2", "bg"],
  ["fg-2", "card"],
  ["fg-3", "card"],
  ["lime-ink", "lime"],
  ["lime-text", "card"],
  ["lime-text", "bg"],
  ["danger", "card"],
];
const GRAPHIC = [
  "chart-line",
  "route",
  "z1",
  "z2",
  "z3",
  "z4",
  "z5",
  "load-low",
  "load-mod",
  "load-high",
  "t-rodaje",
  "t-tirada_larga",
  "t-series",
  "t-tempo",
  "t-recuperacion",
  "t-competicion",
  "t-trail",
  "t-cinta",
];

describe.each(Object.entries(THEMES))("tema %s", (_name, t) => {
  it.each(TEXT)("texto %s sobre %s ≥ 4,5:1", (fg, bg) => {
    expect(t[fg], fg).toMatch(/^#/);
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHIC)("gráfico %s sobre la tarjeta ≥ 3:1", (k) => {
    expect(contrast(t[k], t.card)).toBeGreaterThanOrEqual(3);
  });
  it("la ruta también se distingue sobre el fondo del mapa", () => {
    expect(contrast(t.route, t.map)).toBeGreaterThanOrEqual(3);
  });
});
