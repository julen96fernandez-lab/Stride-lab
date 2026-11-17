import { Logo } from "@/components/ui/Logo";
import { GreetingTitle, TodayLabel } from "@/components/ui/Greeting";
import { ButtonLink, Card, SectionTitle, Stat } from "@/components/ui/primitives";

export default function HomePage() {
  return (
    <div className="stagger flex flex-col gap-4">
      <div className="mt-2 flex items-center justify-between">
        <Logo />
        <TodayLabel />
      </div>

      <div className="mt-3">
        <GreetingTitle />
        <p className="mt-2 text-[15px] text-fg-2">Aún no hay carreras importadas.</p>
      </div>

      <Card hero className="pb-6">
        <div className="eyebrow">VO₂ máx.</div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="num text-[64px] text-fg-3">—</span>
        </div>
        <p className="relative mt-5 max-w-[30ch] text-[14px] leading-relaxed text-fg-2">
          Importa tu export de Apple Health para ver tu evolución, tus carreras y tus rutas.
        </p>
        <div className="relative mt-5">
          <ButtonLink href="/perfil/importar">Importar datos</ButtonLink>
        </div>
      </Card>

      <SectionTitle aside="Sin datos">Últimos 28 días</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <Stat label="Distancia" value={null} unit="km" />
        </Card>
        <Card>
          <Stat label="Ritmo medio" value={null} unit="/km" />
        </Card>
        <Card>
          <Stat label="Tiempo" value={null} />
        </Card>
        <Card>
          <Stat label="Pulso medio" value={null} unit="ppm" />
        </Card>
      </div>
    </div>
  );
}
