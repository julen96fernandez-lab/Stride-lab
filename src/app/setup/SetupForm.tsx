"use client";

import { useActionState } from "react";
import { setup, type FormState } from "../login/actions";
import { FieldError, PasswordField, SubmitButton } from "../login/fields";

export function SetupForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setup, {});
  return (
    <form action={action} className="card flex flex-col gap-5 p-5">
      <PasswordField
        key={state.code ?? ""}
        id="code"
        label="Código de configuración"
        autoComplete="one-time-code"
        autoFocus={!state.code}
        type="text"
        defaultValue={state.code}
      />
      <PasswordField
        id="password"
        label="Nueva contraseña"
        autoComplete="new-password"
        hint="Mínimo 10 caracteres. Puedes usar la contraseña sugerida por el iPhone."
      />
      <PasswordField id="confirm" label="Repite la contraseña" autoComplete="new-password" />
      <FieldError error={state.error} />
      <SubmitButton pending={pending} label="Guardar y entrar" pendingLabel="Guardando…" />
    </form>
  );
}
