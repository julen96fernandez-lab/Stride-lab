import { HomeSkeleton } from "@/components/ui/Skeletons";

/** Al tocar la pestaña se ve esto en el mismo instante (va en la precarga), sin fondo vacío. */
export default function Loading() {
  return (
    <div className="no-fade flex flex-col gap-4">
      <div className="mt-4 flex items-center justify-between">
        <span className="skel block h-9 w-9 rounded-full" />
      </div>
      <HomeSkeleton />
    </div>
  );
}
