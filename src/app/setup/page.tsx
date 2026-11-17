import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { isPasswordSet } from "@/lib/auth/store";
import { SetupForm } from "./SetupForm";

export const metadata = { title: "Primer acceso · Stride Lab" };

/** /setup solo existe mientras no haya contraseña. Después, siempre a /login. */
async function Gate() {
  await connection();
  if (await isPasswordSet()) redirect("/login");
  return <SetupForm />;
}

export default function SetupPage() {
  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-[440px] flex-col px-5 pb-10">
      <div className="mt-6">
        <Logo />
      </div>
      <div className="stagger mt-10 flex flex-col gap-6">
        <div>
          <h1 className="font-display text-[40px] leading-[1.04] font-bold tracking-[-0.035em]">
            Primer <span className="text-lime-text">acceso.</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-2">
            Elige la contraseña con la que entrarás a partir de ahora. Para demostrar que eres tú, escribe el
            código <span className="font-semibold text-fg">SETUP_CODE</span> que guardaste en Vercel.
          </p>
        </div>
        <Suspense fallback={<div className="card h-[420px]" aria-hidden="true" />}>
          <Gate />
        </Suspense>
      </div>
    </main>
  );
}
