/**
 * Avisos breves (toasts) y estados de las acciones largas. Lógica pura: la usan el Toaster y
 * los formularios, y se prueba sin navegador.
 */
export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** ms que se queda visible */
  ttl: number;
}

export type ToastAction = { type: "push"; toast: Omit<Toast, "id" | "ttl"> & { ttl?: number } } | { type: "dismiss"; id: number };

/** Duración por tipo: los errores se quedan más (hay que leerlos). */
export const TOAST_TTL: Record<ToastKind, number> = { success: 2600, info: 3200, error: 6000 };
/** Como mucho tantos a la vez (el más antiguo sale). */
export const MAX_TOASTS = 3;

export function toastReducer(state: { list: Toast[]; next: number }, action: ToastAction): { list: Toast[]; next: number } {
  if (action.type === "dismiss") return { ...state, list: state.list.filter((t) => t.id !== action.id) };
  const t = action.toast;
  // El mismo mensaje seguido no se repite: se renueva.
  const list = state.list.filter((x) => !(x.kind === t.kind && x.text === t.text));
  const toast: Toast = { id: state.next, kind: t.kind, text: t.text, ttl: t.ttl ?? TOAST_TTL[t.kind] };
  return { list: [...list, toast].slice(-MAX_TOASTS), next: state.next + 1 };
}

/** Estado que devuelven las acciones de servidor de los formularios. */
export interface ActionState {
  ok?: string;
  error?: string;
  errors?: Record<string, string | undefined>;
}

/**
 * Qué aviso mostrar al terminar una acción: solo si el estado cambió (no al volver a pintar).
 * Errores por campo → un aviso general que remite al formulario.
 */
export function feedbackFromState(prev: ActionState | null | undefined, next: ActionState | null | undefined): { kind: ToastKind; text: string } | null {
  if (!next || prev === next) return null;
  if (next.error) return { kind: "error", text: next.error };
  const fieldErrors = next.errors ? Object.values(next.errors).filter(Boolean) : [];
  if (fieldErrors.length) return { kind: "error", text: fieldErrors.length === 1 ? fieldErrors[0]! : `Revisa ${fieldErrors.length} campos marcados.` };
  if (next.ok) return { kind: "success", text: next.ok };
  return null;
}

/** Fases de un botón de acción larga. */
export type ActionPhase = "idle" | "pending" | "done" | "error";

export function actionPhase(pending: boolean, state: ActionState | null | undefined, settledAt: number | null, now: number, holdMs = 1600): ActionPhase {
  if (pending) return "pending";
  if (settledAt !== null && now - settledAt < holdMs) return state?.error || (state?.errors && Object.values(state.errors).some(Boolean)) ? "error" : state?.ok ? "done" : "idle";
  return "idle";
}

/**
 * Avisos que sobreviven a una redirección (la acción de servidor redirige y no puede devolver
 * estado): se pasan como ?aviso=clave y la pantalla de destino los muestra y limpia la URL.
 */
export const FLASH: Record<string, { kind: ToastKind; text: string }> = {
  "carrera-guardada": { kind: "success", text: "Carrera guardada." },
  "carrera-actualizada": { kind: "success", text: "Cambios guardados." },
  "carrera-borrada": { kind: "success", text: "Carrera borrada." },
  "carrera-objetivo-creada": { kind: "success", text: "Carrera objetivo guardada." },
  "carrera-objetivo-actualizada": { kind: "success", text: "Cambios guardados." },
  "carrera-objetivo-borrada": { kind: "success", text: "Carrera objetivo borrada." },
};

export const FLASH_PARAM = "aviso";

/** Aviso a mostrar y la URL sin el parámetro (null si no hay aviso conocido). */
export function takeFlash(href: string): { toast: { kind: ToastKind; text: string }; clean: string } | null {
  const url = new URL(href, "http://x");
  const key = url.searchParams.get(FLASH_PARAM);
  if (key === null) return null;
  url.searchParams.delete(FLASH_PARAM);
  const clean = url.pathname + (url.searchParams.size ? `?${url.searchParams}` : "") + url.hash;
  const t = FLASH[key];
  return t ? { toast: t, clean } : { toast: { kind: "info", text: "" }, clean };
}
