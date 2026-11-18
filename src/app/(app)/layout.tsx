import { Suspense, ViewTransition } from "react";
import { TabBar } from "@/components/ui/TabBar";
import { FlashToast } from "@/components/ui/FlashToast";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Transición suave entre pantallas (fundido corto, sin parpadeo); la barra inferior queda fija. */}
      <ViewTransition>
        <main className="pt-safe pb-tabbar mx-auto w-full max-w-[440px] px-4">{children}</main>
      </ViewTransition>
      <Suspense>
        <FlashToast />
        <TabBar />
      </Suspense>
    </>
  );
}
