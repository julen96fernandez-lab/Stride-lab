"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { choiceMatches, choiceUrl, type Choices } from "@/lib/ui/choice";
import { Segmented, type SegmentItem } from "./Segmented";

const Ctx = createContext<{ values: Choices; set: (name: string, v: string) => void } | null>(null);

/**
 * Estado de los selectores de una pantalla. Todas las opciones llegan ya calculadas del
 * servidor; elegir solo cambia qué se enseña (al instante) y la URL (sin ir al servidor).
 */
export function ChoiceProvider({ initial, defaults, children }: { initial: Choices; defaults: Choices; children: ReactNode }) {
  const [values, setValues] = useState(initial);
  const set = useCallback(
    (name: string, v: string) => {
      setValues((prev) => {
        const next = { ...prev, [name]: v };
        try {
          window.history.replaceState(window.history.state, "", choiceUrl(window.location.href, next, defaults));
        } catch {
          /* sin URL no pasa nada: el estado ya cambió */
        }
        return next;
      });
    },
    [defaults],
  );
  const ctx = useMemo(() => ({ values, set }), [values, set]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useChoice(name: string): [string, (v: string) => void] {
  const c = useContext(Ctx);
  if (!c) throw new Error("useChoice fuera de ChoiceProvider");
  return [c.values[name], (v: string) => c.set(name, v)];
}

/** Selector deslizante conectado a una elección. */
export function ChoiceSelector({
  name,
  items,
  label,
  variant,
  stretch,
}: {
  name: string;
  items: Omit<SegmentItem, "href">[];
  label: string;
  variant?: "pill" | "chips";
  stretch?: boolean;
}) {
  const [value, set] = useChoice(name);
  return <Segmented items={items} value={value} onChange={set} label={label} variant={variant} stretch={stretch} />;
}

/** Enseña su contenido solo cuando la elección coincide. */
export function ChoicePanel({ when, children }: { when: Choices; children: ReactNode }) {
  const c = useContext(Ctx);
  if (!c || !choiceMatches(c.values, when)) return null;
  return <>{children}</>;
}
