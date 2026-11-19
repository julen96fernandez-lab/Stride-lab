import { PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";

/** Al tocar la pestaña se ve esto en el mismo instante (va en la precarga), sin fondo vacío. */
export default function Loading() {
  return (
    <div className="no-fade flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader title="Plan" subtitle="Turnos, marcas estimadas y tu semana." />
      </div>
      <span className="skel block h-11 rounded-full" aria-hidden="true" />
      <ProfileSkeleton rows={6} />
    </div>
  );
}
