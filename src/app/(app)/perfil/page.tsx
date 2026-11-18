import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { profileScreen } from "@/lib/db/screens";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { cacheDay } from "@/lib/cache/tags";
import { InjuriesForm } from "./InjuriesForm";
import { GoalsForm } from "./GoalsForm";
import { ShiftForm } from "./ShiftForm";
import { TrainingSettingsForm } from "./TrainingSettingsForm";
import { ThemePicker } from "@/components/ui/ThemePicker";
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
      <ThemePicker />
      <Suspense fallback={<ProfileSkeleton rows={5} />}>
        <GoalsCard />
      </Suspense>
      <Suspense fallback={<ProfileSkeleton rows={1} />}>
        <ShiftCard />
      </Suspense>
      <Suspense fallback={<ProfileSkeleton rows={3} />}>
        <InjuriesCard />
      </Suspense>
      <Suspense fallback={<ProfileSkeleton rows={2} />}>
        <TypeSettingsCard />
      </Suspense>
      <Card>
        <div className="eyebrow">Zapatillas</div>
        <p className="mt-3 text-[14px] text-fg-2">Aún no has añadido zapatillas.</p>
      </Card>
      <form action={logout}>
        <button
          type="submit"
          className="min-h-[48px] w-full rounded-2xl border border-line-strong text-[15px] font-semibold text-fg-2 transition"
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}

async function TypeSettingsCard() {
  await connection();
  const { types, zones } = (await profileScreen(cacheDay())).settings;
  return <TrainingSettingsForm zones={zones} types={types} />;
}

async function GoalsCard() {
  await connection();
  const { goals, suggested } = (await profileScreen(cacheDay())).goals;
  return <GoalsForm goals={goals} suggested={suggested} />;
}

async function InjuriesCard() {
  await connection();
  const { injuries, today } = (await profileScreen(cacheDay())).injuries;
  return <InjuriesForm injuries={injuries} today={today} />;
}

async function ShiftCard() {
  await connection();
  const day = cacheDay();
  const { shiftAnchor } = await profileScreen(day);
  return <ShiftForm anchor={shiftAnchor} today={day} />;
}
