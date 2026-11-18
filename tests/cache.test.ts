import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoOnce } from "@/lib/cache/memo";
import { DATA_LIFE, DATA_TAG, cacheDay } from "@/lib/cache/tags";
import { REFRESH_AFTER_MS, shouldRefresh, tabNavigation } from "@/lib/ui/tabs";

const read = (p: string) => readFileSync(p, "utf8");

describe("memoOnce (lo común, una vez por pantalla)", () => {
  it("la misma clave se pide una sola vez, también si llegan a la vez", async () => {
    const once = memoOnce();
    let calls = 0;
    const f = async () => (calls++, 42);
    const [a, b, c] = await Promise.all([once("runs", f), once("runs", f), once("runs", f)]);
    expect([a, b, c]).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
    await once("goals", f);
    expect(calls).toBe(2);
  });
  it("si falla, se olvida y se puede reintentar", async () => {
    const once = memoOnce();
    let calls = 0;
    await expect(once("x", async () => (calls++, Promise.reject(new Error("red"))))).rejects.toThrow("red");
    await new Promise((r) => setTimeout(r, 0));
    expect(await once("x", async () => (calls++, "ok"))).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("clave y vida de la caché", () => {
  it("el día de la clave es el de Madrid (a medianoche cambia de entrada)", () => {
    expect(cacheDay(new Date("2026-11-18T22:59:00Z"))).toBe("2026-11-18");
    expect(cacheDay(new Date("2026-11-18T23:01:00Z"))).toBe("2026-11-19"); // 00:01 en Madrid
    expect(cacheDay(new Date("2026-07-04T22:30:00Z"))).toBe("2026-07-05"); // verano: UTC+2
  });
  it("caduca como mucho en un día y revalida antes", () => {
    expect(DATA_LIFE.expire).toBeLessThanOrEqual(86_400);
    expect(DATA_LIFE.revalidate).toBeLessThan(DATA_LIFE.expire);
  });
});

describe("invalidación: todo lo que escribe datos invalida la caché", () => {
  const actions = ["src/app/(app)/actividad/actions.ts", "src/app/(app)/perfil/injury-actions.ts", "src/app/(app)/actividad/manual-actions.ts"];
  for (const f of actions) {
    it(`${f}: cada acción exportada llama a dataChanged()`, () => {
      const src = read(f);
      const bodies = src.split(/\nexport async function /).slice(1);
      expect(bodies.length).toBeGreaterThan(0);
      for (const b of bodies) {
        const name = b.slice(0, b.indexOf("("));
        // vista previa sin guardar: no cambia datos
        if (name === "manualRunAction") expect(b, name).toMatch(/dataChanged\(\);\s*\n\s*refresh\(\);\s*\n\s*redirect/);
        else expect(b, name).toContain("dataChanged()");
      }
    });
  }
  it("cada tramo de la importación (Reprocesar incluido) caduca la caché", () => {
    expect(read("src/app/api/import/[id]/step/route.ts")).toContain("dataChangedInRoute()");
  });
  it("las pantallas con caché llevan la etiqueta común y la vida definida", () => {
    const src = read("src/lib/db/screens.ts");
    const fns = src.split(/\nexport async function /).slice(1);
    expect(fns.length).toBeGreaterThanOrEqual(6);
    for (const f of fns) {
      expect(f).toContain('"use cache: remote"');
      expect(f).toContain("cacheTag(DATA_TAG)");
      expect(f).toContain("cacheLife(DATA_LIFE)");
      expect(f).toMatch(/\(.*day: string\)/); // el día en la clave
    }
    expect(DATA_TAG).toBe("datos");
  });
  it("ninguna página de la app lee de la base de datos sin pasar por la caché", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n === "page.tsx") files.push(p);
      }
    };
    walk("src/app/(app)");
    const direct = files.filter((f) => /\b(getHome|getHomeOverview|listRuns|getRun|getAnalysis|getPeriodsView|getInsights|getEfficiency|getFitness|getRecords|getTrainingSettingsView|getGoalsSettings|getInjuriesView)\(/.test(read(f)));
    expect(direct).toEqual([]);
  });
});

describe("pestañas", () => {
  it("tocar la pestaña en la que estás solo sube arriba; otra pestaña navega", () => {
    expect(tabNavigation("/analisis", "/analisis")).toBe("top");
    expect(tabNavigation("/analisis", "/actividad")).toBe("navigate");
    expect(tabNavigation("/actividad/abc", "/actividad")).toBe("navigate");
  });
  it("volver a una pestaña: refresco por detrás solo si lo guardado tiene más de un minuto", () => {
    expect(shouldRefresh(undefined, 1000)).toBe(false); // primera visita: ya llega fresca
    expect(shouldRefresh(1000, 1000 + 30_000)).toBe(false);
    expect(shouldRefresh(1000, 1000 + REFRESH_AFTER_MS + 1)).toBe(true);
  });
  it("las pestañas se precargan y el scroll de los chips no mueve la página", () => {
    expect(read("src/components/ui/TabBar.tsx")).toMatch(/<Link\s+href=\{tab\.href\}\s+prefetch/);
    expect(read("src/components/ui/Segmented.tsx")).not.toMatch(/\.scrollIntoView\(/);
  });
});

describe("cambio de pestaña sin fotogramas vacíos ni tirones", () => {
  const css = read("src/app/globals.css");
  it("sin View Transitions (capturas de pantalla que dejaban un fotograma negro y otro blanco)", () => {
    expect(css).not.toMatch(/view-transition/);
    expect(read("src/app/(app)/layout.tsx")).not.toMatch(/ViewTransition/);
  });
  it("fondo del tema en html y body desde el primer fotograma", () => {
    expect(css).toMatch(/html \{[^}]*background-color: var\(--bg\)/);
    expect(css).toMatch(/body \{[^}]*background-color: var\(--bg\)/);
  });
  it("fundido de ≤ 150 ms solo de opacidad (sin desplazamiento ni escala), nunca desde transparente", () => {
    const kf = /@keyframes page-fade \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(kf).not.toMatch(/transform|translate|scale/);
    const from = Number(/from \{\s*opacity: ([\d.]+)/.exec(kf)![1]);
    expect(from).toBeGreaterThan(0.3);
    const ms = Number(/animation: page-fade (\d+)ms/.exec(css)![1]);
    expect(ms).toBeLessThanOrEqual(150);
    expect(css).not.toMatch(/@keyframes rise/);
  });
  it("barra fija, sin animarse y casi opaca", () => {
    const bar = read("src/components/ui/TabBar.tsx");
    expect(bar).not.toMatch(/transition/);
    const pct = Number(/\.tabbar-surface \{\s*background-color: color-mix\(in srgb, var\(--card\) (\d+)%/.exec(css)![1]);
    expect(pct).toBeGreaterThanOrEqual(90);
  });
  it("cada pestaña tiene esqueleto inmediato (loading.tsx) sin fundido", () => {
    for (const d of ["", "/actividad", "/analisis", "/perfil", "/actividad/[id]"]) {
      expect(read(`src/app/(app)${d}/loading.tsx`)).toContain("no-fade");
    }
  });
});
