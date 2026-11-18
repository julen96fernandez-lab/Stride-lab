/** Estado vacío o con pocos datos de un gráfico: un dibujo discreto y un mensaje corto. */
export function ChartEmpty({ message, height = 120, kind = "line" }: { message: string; height?: number; kind?: "line" | "bars" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-center" style={{ height }} role="note">
      <svg width="64" height="28" viewBox="0 0 64 28" aria-hidden="true" className="text-fg-3">
        {kind === "bars" ? (
          [6, 16, 26, 36, 46].map((x, i) => <rect key={x} x={x} y={28 - [10, 16, 8, 20, 13][i]} width="7" height={[10, 16, 8, 20, 13][i]} rx="2" fill="currentColor" opacity="0.35" />)
        ) : (
          <path d="M2 22 C 12 20, 16 8, 26 12 S 42 22, 50 10 S 60 6, 62 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" opacity="0.6" />
        )}
      </svg>
      <p className="max-w-[240px] px-3 text-[12px] leading-snug text-fg-2">{message}</p>
    </div>
  );
}
