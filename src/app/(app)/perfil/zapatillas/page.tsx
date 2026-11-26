import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { shoesScreen } from "@/lib/db/screens";
import { cacheDay } from "@/lib/cache/tags";
import { ShoesManager } from "./ShoesManager";

export const metadata = { title: "Zapatillas · Stride Lab" };

async function Shoes() {
  await connection();
  const day = cacheDay();
  const shoes = await shoesScreen(day);
  return <ShoesManager shoes={shoes} today={day} />;
}

export default function ShoesPage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <Link href="/perfil" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Perfil
      </Link>
      <PageHeader title="Zapatillas" subtitle="Km de cada par, con aviso suave desde el 80 % del límite." />
      <Suspense fallback={<ProfileSkeleton rows={3} />}>
        <Shoes />
      </Suspense>
    </div>
  );
}
