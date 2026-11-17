"use client";

import { useEffect, useOptimistic, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRunType } from "@/app/(app)/actividad/actions";
import { SESSION_TYPES, TYPE_META, type SessionType } from "@/lib/analysis/session-type";
import { SessionIcon } from "./SessionType";

/**
 * Selector de tipo con un toque: fila de chips; el elegido va en lima.
 * Competición solo se marca aquí, a mano.
 */
export function TypePicker({
  runId,
  autoType,
  autoReason,
  manualType,
}: {
  runId: string;
  autoType: SessionType | null;
  autoReason: string | null;
  manualType: SessionType | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [manual, setManual] = useOptimistic<SessionType | null>(manualType);
  const current = manual ?? autoType;
  const rowRef = useRef<HTMLDivElement>(null);

  // El tipo elegido siempre a la vista dentro de la fila deslizable.
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const row = rowRef.current;
    if (el && row) row.scrollTo({ left: el.offsetLeft - row.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [current]);

  const choose = (t: SessionType | "auto") =>
    start(async () => {
      setManual(t === "auto" ? null : t);
      const res = await setRunType(runId, t);
      if (res.ok) router.refresh();
    });

  return (
    <section className="card p-4" aria-busy={pending}>
      <div className="flex items-baseline justify-between px-1">
        <div className="eyebrow">Tipo de sesión</div>
        <span className="text-[11px] text-fg-2">{manual ? "Elegido a mano" : "Automático"}</span>
      </div>
      <div ref={rowRef} className="-mx-4 mt-3 overflow-x-auto px-4 [scrollbar-width:none]" role="radiogroup" aria-label="Tipo de sesión">
        <div className="flex w-max gap-2 pb-1">
          {SESSION_TYPES.map((t) => {
            const m = TYPE_META[t];
            const active = current === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => (active && manual === t ? choose("auto") : choose(t))}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition active:scale-[0.97] ${
                  active
                    ? "border-lime bg-lime text-lime-ink shadow-[0_0_18px_rgba(200,242,58,0.4)]"
                    : "border-line-strong bg-white/[0.03] text-fg"
                }`}
              >
                <span style={{ color: active ? undefined : m.color }} className="flex">
                  <SessionIcon type={t} size={16} />
                </span>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 px-1 text-[12px] leading-relaxed text-fg-2">
        {autoType ? (
          <>
            Automático: <span className="font-semibold text-fg">{TYPE_META[autoType].label}</span>
            {autoReason ? ` · ${autoReason}` : ""}
          </>
        ) : (
          "Sin tipo automático."
        )}
        {manual && (
          <button type="button" onClick={() => choose("auto")} className="ml-2 min-h-[32px] font-semibold text-lime underline-offset-2 hover:underline">
            Volver a automático
          </button>
        )}
      </div>
    </section>
  );
}
