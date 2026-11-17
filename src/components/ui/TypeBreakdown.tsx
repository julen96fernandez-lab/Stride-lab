import Link from "next/link";
import { TYPE_META } from "@/lib/analysis/session-type";
import type { KmByType } from "@/lib/db/queries";
import { int } from "@/lib/format";
import { SessionIcon } from "./SessionType";

/**
 * Km por tipo: barra apilada (con separaciones de 2 px) + filas ordenadas con icono,
 * nombre, km, % y nº de carreras. Los tipos sin km se omiten de la barra y se listan
 * al final atenuados (no se rellenan).
 */
export function TypeBreakdown({ data, linkToFilter = true }: { data: KmByType[]; linkToFilter?: boolean }) {
  const total = data.reduce((a, d) => a + d.km, 0);
  if (total <= 0) return <p className="mt-3 text-[14px] text-fg-2">Sin carreras en este periodo.</p>;
  const sorted = [...data].sort((a, b) => b.km - a.km);
  const withKm = sorted.filter((d) => d.km > 0);
  const empty = sorted.filter((d) => d.km <= 0);
  return (
    <div>
      <div className="mt-4 flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Reparto de kilómetros por tipo">
        {withKm.map((d) => (
          <div key={d.type} style={{ width: `${(100 * d.km) / total}%`, background: TYPE_META[d.type].color }} className="min-w-[3px] first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <ul className="mt-4 flex flex-col">
        {withKm.map((d) => {
          const row = (
            <div className="flex min-h-[44px] items-center gap-3">
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-xl"
                style={{ color: TYPE_META[d.type].color, background: `${TYPE_META[d.type].color}1f` }}
              >
                <SessionIcon type={d.type} size={17} />
              </span>
              <span className="min-w-0 flex-1 text-[14px] font-semibold">{TYPE_META[d.type].label}</span>
              <span className="text-[12px] text-fg-2">
                {d.runs} · {Math.round((100 * d.km) / total)} %
              </span>
              <span className="num w-[64px] text-right text-[17px]">
                {int(d.km)} <span className="font-sans text-[11px] font-medium text-fg-2">km</span>
              </span>
            </div>
          );
          return (
            <li key={d.type}>
              {linkToFilter ? (
                <Link href={`/actividad?tipo=${d.type}`} className="block active:opacity-70">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
      {empty.length > 0 && (
        <p className="mt-2 text-[12px] text-fg-3">Sin km: {empty.map((d) => TYPE_META[d.type].label).join(", ")}.</p>
      )}
    </div>
  );
}
