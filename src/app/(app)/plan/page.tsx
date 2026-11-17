import { Card, PageHeader, Pill } from "@/components/ui/primitives";

export const metadata = { title: "Plan · Stride Lab" };

export default function PlanPage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Plan" subtitle="Entrenamientos por bloques de 5 semanas." />
      </div>
      <Card hero>
        <div className="flex items-center justify-between">
          <div className="eyebrow">Próximamente</div>
          <Pill>Fase posterior</Pill>
        </div>
        <p className="relative mt-4 text-[15px] leading-relaxed text-fg">
          El plan llegará cuando el historial esté importado y analizado. Primero, tus datos.
        </p>
      </Card>
    </div>
  );
}
