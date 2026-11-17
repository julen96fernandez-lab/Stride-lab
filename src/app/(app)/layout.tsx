import { Suspense } from "react";
import { TabBar } from "@/components/ui/TabBar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="pt-safe pb-tabbar mx-auto w-full max-w-[440px] px-4">{children}</main>
      <Suspense>
        <TabBar />
      </Suspense>
    </>
  );
}
