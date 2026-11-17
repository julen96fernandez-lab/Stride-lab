"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type FormState } from "./actions";
import { FieldError, PasswordField, SubmitButton } from "./fields";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});

  return (
    <form action={action} className="card flex flex-col gap-4 p-5">
      <input type="hidden" name="next" value={next} />
      <PasswordField id="password" label="Contraseña" autoComplete="current-password" autoFocus error={state.error} />
      <FieldError error={state.error} />
      <SubmitButton pending={pending} label="Entrar" pendingLabel="Entrando…" />
    </form>
  );
}
