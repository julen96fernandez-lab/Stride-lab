"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="card flex flex-col gap-4 p-5">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password" className="eyebrow">
        Contraseña
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        className="h-14 rounded-2xl border border-line-strong bg-black/30 px-4 text-[17px] text-fg outline-none placeholder:text-fg-3 focus:border-lime"
        placeholder="••••••••••"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "login-error" : undefined}
      />
      {state.error && (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-14 rounded-2xl bg-lime text-[16px] font-semibold text-lime-ink transition active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
