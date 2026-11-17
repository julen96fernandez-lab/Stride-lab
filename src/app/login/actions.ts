"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MIN_PASSWORD_LENGTH, hashPassword, safeEqual, verifyPassword } from "@/lib/auth/password";
import { getPasswordHash, setInitialPasswordHash } from "@/lib/auth/store";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";

export type FormState = { error?: string; code?: string };

const slowDown = () => new Promise((r) => setTimeout(r, 800));

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  // Solo rutas internas: evita redirecciones abiertas.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

async function startSession() {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const stored = await getPasswordHash();
  if (!stored) redirect("/setup");
  const ok = password.length > 0 && (await verifyPassword(password, stored));
  if (!ok) {
    await slowDown();
    return { error: "Contraseña incorrecta" };
  }
  await startSession();
  redirect(safeNext(formData.get("next")));
}

export async function setup(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get("code") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const expected = process.env.SETUP_CODE;

  if (!expected) return { error: "Falta la variable SETUP_CODE en Vercel." };
  if (await getPasswordHash()) redirect("/login");
  if (!safeEqual(code, expected)) {
    await slowDown();
    return { error: "Código de configuración incorrecto" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`, code };
  }
  if (password !== confirm) return { error: "Las contraseñas no coinciden", code };

  const saved = await setInitialPasswordHash(await hashPassword(password));
  if (!saved) redirect("/login");
  await startSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
