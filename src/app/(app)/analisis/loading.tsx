import { PageHeader } from "@/components/ui/primitives";
import { AnalysisSkeleton } from "@/components/ui/Skeletons";

/** Al tocar la pestaña se ve esto en el mismo instante (va en la precarga), sin fondo vacío. */
export default function Loading() {
  return (
    <div className="no-fade flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Análisis" subtitle="Tu evolución, no solo tus kilómetros." />
      </div>
      <AnalysisSkeleton />
    </div>
  );
}
