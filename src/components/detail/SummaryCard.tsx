import type { SummaryLine, Tone } from "@/lib/analysis/summary";

const TONE: Record<Tone, { color: string; label: string }> = {
  good: { color: "var(--load-low)", label: "Bien" },
  watch: { color: "var(--load-mod)", label: "A tener en cuenta" },
  neutral: { color: "var(--fg-3)", label: "" },
};

/** Resumen en lenguaje claro: frases con reglas; verde lo bueno, ámbar lo que merece atención. */
export function SummaryCard({ lines }: { lines: SummaryLine[] }) {
  if (!lines.length) return null;
  return (
    <section className="card p-5" aria-label="Resumen">
      <div className="eyebrow">Resumen</div>
      <ul className="mt-3 flex flex-col gap-2">
        {lines.map((l) => (
          <li key={l.text} className="flex gap-2.5 text-[14px] leading-snug">
            <span className="mt-[7px] h-2 w-2 flex-none rounded-full" style={{ background: TONE[l.tone].color }} aria-hidden="true" />
            <span>
              {TONE[l.tone].label && <span className="sr-only">{TONE[l.tone].label}: </span>}
              {l.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-snug text-fg-3">Con reglas a partir de tus datos. Dice lo que coincidió, no las causas. Verde: bien; ámbar: a tener en cuenta.</p>
    </section>
  );
}
