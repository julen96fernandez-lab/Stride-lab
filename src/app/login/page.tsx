import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { isPasswordSet } from "@/lib/auth/store";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Entrar · Stride Lab" };

/** Si todavía no hay contraseña, el primer acceso va a /setup. */
async function RequireConfigured() {
  await connection();
  if (!(await isPasswordSet())) redirect("/setup");
  return null;
}

export default function LoginPage() {
  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-[440px] flex-col px-5 pb-10">
      <div className="mt-6">
        <Logo />
      </div>
      <div className="stagger mt-auto mb-auto flex flex-col gap-6 pt-16">
        <div>
          <h1 className="font-display text-[44px] leading-[1.02] font-bold tracking-[-0.035em]">
            Tu laboratorio
            <br />
            <span className="text-lime">de running.</span>
          </h1>
          <p className="mt-3 text-[15px] text-fg-2">Acceso privado. Solo para ti.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
      <Suspense>
        <RequireConfigured />
      </Suspense>
    </main>
  );
}
