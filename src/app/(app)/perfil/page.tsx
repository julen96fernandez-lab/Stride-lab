import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { saveTypeSettingsAction } from "@/app/(app)/actividad/actions";
import { getTypeSettingsView } from "@/lib/db/queries";
import { logout } from "@/app/login/actions";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Perfil · Stride Lab" };

function Row({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="flex min-h-[56px] items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[13px] text-fg-2">{detail}</div>
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="flex-none text-fg-3">
        <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </Link>
  );
}

export default function ProfilePage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Perfil" subtitle="Datos, zapatillas y ajustes." />
      </div>
      <Card className="py-2">
        <Row href="/perfil/importar" title="Importar datos" detail="Export de Apple Health (.zip)" />
      </Card>
      <Suspense fallback={<div className="card h-[220px]" aria-hidden="true" />}>
        <TypeSettingsCard />
      </Suspense>
      <Card>
        <div className="eyebrow">Zapatillas</div>
        <p className="mt-3 text-[14px] text-fg-2">Aún no has añadido zapatillas.</p>
      </Card>
      <form action={logout}>
        <button
          type="submit"
          className="min-h-[48px] w-full rounded-2xl border border-line-strong text-[15px] font-semibold text-fg-2 transition active:scale-[0.98]"
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}

async function TypeSettingsCard() {
  await connection();
  const t = await getTypeSettingsView();
  const field =
    "h-12 w-[92px] rounded-xl border border-line-strong bg-black/30 px-3 text-right text-[17px] text-fg outline-none focus:border-lime";
  return (
    <Card>
      <div className="eyebrow">Tipos de sesión</div>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
        Reglas automáticas: intervalos del reloj → Series; indoor → Cinta; distancia → Tirada larga; desnivel por km →
        Trail; ritmo y pulso frente a tu media → Tempo, Rodaje o Recuperación. Competición, solo a mano.
      </p>
      <form action={saveTypeSettingsAction} className="mt-4 flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span>Tirada larga desde</span>
          <span className="flex items-center gap-2">
            <input name="longRunKm" inputMode="decimal" defaultValue={String(t.longRunKm).replace(".", ",")} className={field} aria-label="Kilómetros mínimos de una tirada larga" />
            <span className="w-[44px] text-fg-2">km</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span>Trail desde</span>
          <span className="flex items-center gap-2">
            <input name="trailMPerKm" inputMode="numeric" defaultValue={String(t.trailMPerKm)} className={field} aria-label="Metros de desnivel por km para trail" />
            <span className="w-[44px] text-fg-2">m/km</span>
          </span>
        </label>
        <button
          type="submit"
          className="mt-1 min-h-[48px] rounded-2xl bg-lime text-[15px] font-semibold text-lime-ink transition active:scale-[0.98]"
        >
          Guardar y recalcular
        </button>
        <p className="text-[12px] text-fg-3">Los tipos elegidos a mano no se cambian.</p>
      </form>
    </Card>
  );
}
