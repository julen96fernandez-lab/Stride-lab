import Link from "next/link";
import { Card, PageHeader, Pill } from "@/components/ui/primitives";

export const metadata = { title: "Importar · Stride Lab" };

export default function ImportPage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <Link href="/perfil" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-fg-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Perfil
      </Link>
      <PageHeader title="Importar" subtitle="Tu export de Apple Health." />
      <Card hero>
        <div className="flex items-center justify-between">
          <div className="eyebrow">Importador</div>
          <Pill>En construcción</Pill>
        </div>
        <p className="relative mt-4 text-[15px] leading-relaxed text-fg">
          Aquí podrás subir el .zip. Se guardará en Vercel Blob y se procesará en el servidor por lotes, con
          progreso y reanudación.
        </p>
      </Card>
    </div>
  );
}
