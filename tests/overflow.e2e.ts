/**
 * Formularios sin desbordes horizontales en iPhone estrecho (320, 375 y 390 px), en modo claro y
 * oscuro. Con la app en marcha:
 *   E2E=1 E2E_URL=http://localhost:3100 APP_PASSWORD=… npx vitest run
 *
 * Chromium no tiene el ancho mínimo que iOS da a los campos de fecha y hora, así que se imita con
 * IOS_DATE (el contenido interno del campo no encoge de 190 px). Un control comprueba que, sin el
 * arreglo, la prueba sí detecta el desborde.
 */
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Playwright viene instalado en el entorno (no es dependencia del proyecto): se carga con require.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;
type Browser = any;
const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch: () => Promise<Browser> } };

const BASE = process.env.E2E_URL ?? "http://localhost:3100";
const PASSWORD = process.env.APP_PASSWORD ?? "";
const WIDTHS = [320, 375, 390];
const SCHEMES = ["dark", "light"] as const;
const IOS_DATE = `input[type=date]::-webkit-datetime-edit, input[type=time]::-webkit-datetime-edit { min-width: 190px; flex: none; }`;
const UNDO_FIX = `${IOS_DATE}
  input[type=date], input[type=time] { min-width: auto !important; display: inline-flex !important; }
  .form-row { grid-template-columns: 1fr 1fr !important; }
  .form-row > * { min-width: auto !important; }`;

// Perfil: sus campos (pulso máximo) están visibles sin tocar nada; se abre además el de lesión.
/** Lunes de la semana pasada (para «Resumen de la semana»). */
const LAST_MONDAY = (() => {
  const d = new Date();
  const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000 - 7 * 86_400_000;
  return new Date(mon).toISOString().slice(0, 10);
})();

const FORMS: { name: string; path: string; ready?: string; open?: (p: Page) => Promise<void> }[] = [
  { name: "Añadir carrera", path: "/actividad/nueva" },
  { name: "Sesión prevista", path: "/plan/sesion/nueva" },
  { name: "Carrera objetivo", path: "/plan/carrera/nueva" },
  { name: "Perfil (con el formulario de lesión abierto)", path: "/perfil", open: async (p) => p.getByRole("button", { name: /Añadir periodo/ }).first().click() },
  { name: "Plan · Calendario", path: "/plan?vista=calendario", ready: "section[aria-label='Calendario'] [role=grid]" },
  { name: "Resumen de la semana (la anterior)", path: `/analisis/semana/${LAST_MONDAY}`, ready: "section[aria-label='Resumen']" },
  { name: "Inicio (con «Semana pasada»)", path: "/", ready: "section[aria-label='Semana pasada']" },
  { name: "Récords (con la evolución abierta)", path: "/analisis/records?d=10k", ready: "#evolucion" },
  { name: "Análisis (con «Intensidad» y «Últimas 12 semanas»)", path: "/analisis", ready: "section[aria-label='Intensidad']" },
  {
    name: "Plan · Calendario (hoja del día, con «Mover a…» abierto si hay sesión)",
    path: "/plan?vista=calendario",
    ready: "section[aria-label='Calendario'] [role=grid]",
    open: async (p) => {
      await p.locator("section[aria-label='Calendario'] [role=gridcell][aria-label*='hoy']").first().click();
      await p.locator("[role=dialog]").waitFor();
      const move = p.locator("[role=dialog]").getByRole("button", { name: "Mover a…" });
      if (await move.count()) await move.first().click();
    },
  },
];

/** Problemas de maquetación: página más ancha que la pantalla, campos fuera o montados. */
async function problems(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`la página mide ${document.documentElement.scrollWidth}px de ancho (pantalla ${vw}px)`);
    const fields = [...document.querySelectorAll<HTMLElement>("main input:not([type=hidden]):not([type=checkbox]):not([type=file]), main select, main textarea")].filter(
      (e) => e.offsetParent !== null,
    );
    const rects = fields.map((e) => ({ e, r: e.getBoundingClientRect(), name: (e as HTMLInputElement).name || e.tagName }));
    for (const { e, r, name } of rects) {
      if (r.left < -1 || r.right > vw + 1) out.push(`${name} se sale de la pantalla (${Math.round(r.left)}–${Math.round(r.right)})`);
      const card = e.closest(".card, form > div, section");
      if (card) {
        const c = card.getBoundingClientRect();
        if (r.right > c.right + 1) out.push(`${name} se sale de su tarjeta`);
      }
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) out.push(`${rects[i].name} y ${rects[j].name} se montan`);
      }
    return out;
  });
}

const d = process.env.E2E ? describe : describe.skip;

d("formularios sin desbordes en iPhone estrecho", () => {
  let browser: Browser;
  let cookies: unknown[];
  beforeAll(async () => {
    browser = await chromium.launch();
    const p = await browser.newPage();
    await p.goto(`${BASE}/login`);
    await p.fill("#password", PASSWORD);
    await p.click("button[type=submit]");
    await p.waitForURL(`${BASE}/`);
    cookies = await p.context().cookies();
    await p.close();
  });
  afterAll(() => browser?.close());

  const visit = async (width: number, scheme: (typeof SCHEMES)[number], f: (typeof FORMS)[number], css: string) => {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, hasTouch: true });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    await p.goto(`${BASE}${f.path}`);
    await p.locator(f.ready ?? "main input[type=date], main input[name=maxHr], main input[name=distanceKm]").first().waitFor({ state: "visible" });
    await p.addStyleTag({ content: css });
    if (f.open) await f.open(p);
    await p.waitForTimeout(150);
    const out = await problems(p);
    await ctx.close();
    return out;
  };

  for (const f of FORMS)
    for (const w of WIDTHS)
      for (const s of SCHEMES)
        it(`${f.name} · ${w}px · ${s === "dark" ? "oscuro" : "claro"}`, async () => {
          expect(await visit(w, s, f, IOS_DATE)).toEqual([]);
        });

  it("control: sin el arreglo, la prueba detecta el desborde de Fecha y Hora", async () => {
    const out = await visit(375, "dark", FORMS[0], UNDO_FIX);
    expect(out.join(" | ")).toMatch(/se sale|se montan|la página mide/);
  });
});
