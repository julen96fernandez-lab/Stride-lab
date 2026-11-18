import { Suspense } from "react";
import { TabBar } from "@/components/ui/TabBar";
import { FlashToast } from "@/components/ui/FlashToast";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Cada pantalla entra con un fundido corto (CSS .app-main > *), sin capturas de pantalla ni
          desplazamientos: nunca hay un fotograma vacío. La barra inferior queda fija. */}
      <main className="app-main pt-safe pb-tabbar mx-auto w-full max-w-[440px] px-4">{children}</main>
      <Suspense>
        <FlashToast />
        <TabBar />
      </Suspense>
    </>
  );
}
