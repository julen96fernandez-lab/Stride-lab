"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";

export type LoginState = { error?: string };

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  // Solo rutas internas: evita redirecciones abiertas.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const ok = password.length > 0 && (await verifyPassword(password, process.env.AUTH_PASSWORD_HASH));
  if (!ok) {
    // Frena intentos repetidos.
    await new Promise((r) => setTimeout(r, 800));
    return { error: "Contraseña incorrecta" };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
