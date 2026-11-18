import { DetailSkeleton } from "@/components/ui/Skeletons";

export default function Loading() {
  return (
    <div className="no-fade flex flex-col gap-4 pt-4">
      <DetailSkeleton />
    </div>
  );
}
