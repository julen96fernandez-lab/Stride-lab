import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionPhase, feedbackFromState, FLASH, MAX_TOASTS, takeFlash, TOAST_TTL, toastReducer } from "@/lib/ui/feedback";

const empty = { list: [], next: 1 };

describe("toastReducer", () => {
  it("añade con id creciente y la duración de su tipo", () => {
    const s = toastReducer(empty, { type: "push", toast: { kind: "success", text: "Guardado." } });
    expect(s.list).toEqual([{ id: 1, kind: "success", text: "Guardado.", ttl: TOAST_TTL.success }]);
    expect(s.next).toBe(2);
    const e = toastReducer(s, { type: "push", toast: { kind: "error", text: "Fallo." } });
    expect(e.list[1]).toMatchObject({ id: 2, ttl: TOAST_TTL.error });
    expect(TOAST_TTL.error).toBeGreaterThan(TOAST_TTL.success);
  });
  it("el mismo aviso seguido no se apila: se renueva", () => {
    let s = toastReducer(empty, { type: "push", toast: { kind: "success", text: "Guardado." } });
    s = toastReducer(s, { type: "push", toast: { kind: "success", text: "Guardado." } });
    expect(s.list).toHaveLength(1);
    expect(s.list[0].id).toBe(2);
  });
  it(`como mucho ${MAX_TOASTS} a la vez; sale el más antiguo`, () => {
    let s = empty as ReturnType<typeof toastReducer>;
    for (let i = 0; i < 5; i++) s = toastReducer(s, { type: "push", toast: { kind: "info", text: `m${i}` } });
    expect(s.list.map((t) => t.text)).toEqual(["m2", "m3", "m4"]);
  });
  it("cerrar quita solo ese", () => {
    let s = toastReducer(empty, { type: "push", toast: { kind: "info", text: "a" } });
    s = toastReducer(s, { type: "push", toast: { kind: "info", text: "b" } });
    s = toastReducer(s, { type: "dismiss", id: 1 });
    expect(s.list.map((t) => t.text)).toEqual(["b"]);
  });
  it("duración a medida", () => {
    const s = toastReducer(empty, { type: "push", toast: { kind: "info", text: "x", ttl: 900 } });
    expect(s.list[0].ttl).toBe(900);
  });
});

describe("feedbackFromState", () => {
  it("nada si el estado no cambió (repintado)", () => {
    const st = { ok: "Guardado." };
    expect(feedbackFromState(st, st)).toBeNull();
    expect(feedbackFromState(null, undefined)).toBeNull();
  });
  it("éxito con el mensaje de la acción", () => {
    expect(feedbackFromState({}, { ok: "Objetivos guardados." })).toEqual({ kind: "success", text: "Objetivos guardados." });
  });
  it("el error manda sobre el éxito", () => {
    expect(feedbackFromState({}, { ok: "x", error: "No se pudo guardar." })).toEqual({ kind: "error", text: "No se pudo guardar." });
  });
  it("errores por campo: uno se muestra tal cual; varios, un resumen", () => {
    expect(feedbackFromState({}, { errors: { date: "Fecha no válida.", km: undefined } })).toEqual({ kind: "error", text: "Fecha no válida." });
    expect(feedbackFromState({}, { errors: { date: "a", km: "b", h: "c" } })).toEqual({ kind: "error", text: "Revisa 3 campos marcados." });
  });
  it("un resultado nuevo igual al anterior sí avisa (se guardó otra vez)", () => {
    expect(feedbackFromState({ ok: "Guardado." }, { ok: "Guardado." })).toEqual({ kind: "success", text: "Guardado." });
  });
  it("estado sin mensaje (p. ej. solo vista previa): sin aviso", () => {
    expect(feedbackFromState({}, {})).toBeNull();
  });
});

describe("actionPhase", () => {
  it("trabajando mientras la acción está en curso", () => {
    expect(actionPhase(true, { ok: "x" }, 0, 0)).toBe("pending");
  });
  it("hecho o error durante un momento tras terminar, luego reposo", () => {
    expect(actionPhase(false, { ok: "x" }, 1000, 1500)).toBe("done");
    expect(actionPhase(false, { error: "x" }, 1000, 1500)).toBe("error");
    expect(actionPhase(false, { errors: { a: "x" } }, 1000, 1500)).toBe("error");
    expect(actionPhase(false, { ok: "x" }, 1000, 1000 + 1600)).toBe("idle");
  });
  it("sin terminar nunca: reposo", () => {
    expect(actionPhase(false, {}, null, 5000)).toBe("idle");
    expect(actionPhase(false, {}, 1000, 1200)).toBe("idle");
  });
});

describe("takeFlash (aviso tras redirigir)", () => {
  it("lee el aviso y limpia la URL", () => {
    expect(takeFlash("/actividad/abc?aviso=carrera-guardada")).toEqual({ toast: FLASH["carrera-guardada"], clean: "/actividad/abc" });
    expect(takeFlash("/actividad?tipo=series&aviso=carrera-borrada#x")).toEqual({ toast: FLASH["carrera-borrada"], clean: "/actividad?tipo=series#x" });
  });
  it("sin aviso: nada", () => {
    expect(takeFlash("/actividad?tipo=series")).toBeNull();
  });
  it("aviso desconocido: limpia la URL sin mostrar texto", () => {
    expect(takeFlash("/x?aviso=raro")).toEqual({ toast: { kind: "info", text: "" }, clean: "/x" });
  });
});

describe("estilos de interacción (una sola definición)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  it("toque inmediato sin resaltado gris de iOS", () => {
    expect(css).toMatch(/touch-action:\s*manipulation/);
    expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });
  it("pulsado: escala 0,97 y brillo, 100–150 ms", () => {
    expect(css).toMatch(/--press-scale:\s*0\.97/);
    expect(css).toMatch(/:active\s*\{[^}]*transform:\s*scale\(var\(--press-scale\)\)[^}]*filter:\s*brightness/);
    expect(css).toMatch(/transform 120ms/);
  });
  it("foco visible, desactivado claro y movimiento reducido", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/:disabled,[\s\S]*?opacity:\s*0\.45/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
  it("sin parches por pantalla: ningún componente redefine el pulsado", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync("grep -rlE 'active:(scale|opacity)|disabled:opacity' src --include=*.tsx || true").toString().trim();
    expect(hits).toBe("");
  });
});
