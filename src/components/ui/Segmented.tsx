"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SegmentItem {
  key: string;
  label: ReactNode;
  /** Si lleva href, navega (filtros por URL); si no, llama a onChange. */
  href?: string;
  ariaLabel?: string;
}

/**
 * Selector con indicador deslizante animado hacia la opción elegida. Una sola pieza para
 * semana/mes/año, total/por tipo, distancia/tiempo, rangos, tipos, temas…
 * - `pill`: opciones repartidas en una cápsula.
 * - `chips`: fila desplazable de chips (el indicador sigue al elegido).
 */
export function Segmented({
  items,
  value,
  onChange,
  label,
  variant = "pill",
  stretch = false,
}: {
  items: SegmentItem[];
  value: string | null;
  onChange?: (key: string) => void;
  label: string;
  variant?: "pill" | "chips";
  stretch?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [ind, setInd] = useState<{ x: number; w: number; ready: boolean } | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = value ? refs.current[value] : null;
    if (!el) {
      setInd(null);
      return;
    }
    const place = () => setInd((p) => ({ x: el.offsetLeft, w: el.offsetWidth, ready: p !== null }));
    place();
    // Solo se desplaza la fila de chips en horizontal: scrollIntoView también movía la página
    // (Análisis se abría abajo del todo).
    const row = variant === "chips" ? box.current?.parentElement : null;
    if (row) {
      const left = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
      if (Math.abs(row.scrollLeft - left) > 1) row.scrollTo({ left, behavior: first.current ? "auto" : "smooth" });
    }
    first.current = false;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, variant, items.length]);

  const chips = variant === "chips";
  return (
    <div className={chips ? "-mx-5 overflow-x-auto px-5 [scrollbar-width:none]" : stretch ? "w-full" : "inline-flex"}>
      <div
        ref={box}
        role="radiogroup"
        aria-label={label}
        className={`segmented relative flex ${chips ? "w-max gap-1.5" : `${stretch ? "w-full" : ""} rounded-full border border-line-strong p-1`}`}
      >
        {ind && (
          <span
            aria-hidden="true"
            className={`segmented-ind pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-lime shadow-[0_0_16px_rgba(200,242,58,0.35)] ${ind.ready ? "" : "no-anim"} ${chips ? "!top-0 !bottom-0" : ""}`}
            style={{ transform: `translateX(${ind.x}px)`, width: ind.w }}
          />
        )}
        {items.map((it) => {
          const active = it.key === value;
          const cls = `relative z-[1] flex min-h-[44px] items-center justify-center gap-1 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-150 ${
            stretch ? "flex-1" : "flex-none"
          } ${active ? "text-lime-ink" : chips ? "border border-line-strong text-fg-2" : "text-fg-2"} ${active && chips ? "border border-transparent" : ""}`;
          const common = {
            ref: (el: HTMLElement | null) => {
              refs.current[it.key] = el;
            },
            role: "radio" as const,
            "aria-checked": active,
            "aria-label": it.ariaLabel,
            className: cls,
          };
          return it.href ? (
            <Link key={it.key} href={it.href} scroll={false} {...common}>
              {it.label}
            </Link>
          ) : (
            <button key={it.key} type="button" onClick={() => onChange?.(it.key)} {...common}>
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
