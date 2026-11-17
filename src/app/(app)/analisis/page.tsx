import { Card, PageHeader, Stat } from "@/components/ui/primitives";

export const metadata = { title: "Análisis · Stride Lab" };

export default function AnalysisPage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Análisis" subtitle="Tu evolución, no solo tus kilómetros." />
      </div>
      <Card hero>
        <Stat label="VO₂ máx." value={null} size="lg" hint="Sin lecturas importadas." />
      </Card>
      <Card>
        <Stat label="Ritmo con el mismo pulso" value={null} hint="Franja 140–150 ppm · carreras de 5 km o más." />
      </Card>
      <Card>
        <Stat label="Kilómetros por año" value={null} />
      </Card>
    </div>
  );
}
