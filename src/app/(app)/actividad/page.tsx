import { ButtonLink, Card, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Actividad · Stride Lab" };

export default function ActivityPage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Actividad" subtitle="Todas tus carreras." />
      </div>
      <Card>
        <div className="eyebrow">Sin carreras</div>
        <p className="mt-3 text-[15px] leading-relaxed text-fg-2">
          Cuando importes tu export de Apple Health aparecerán aquí, de la más reciente a la más antigua.
        </p>
        <div className="mt-5">
          <ButtonLink href="/perfil/importar" variant="ghost">
            Ir a importar
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
