"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Número que cuenta hasta `value`. `format` recibe el valor intermedio.
 * Respeta «reducir movimiento». Se usará con datos reales desde el paso 5.
 */
export function CountUp({
  value,
  decimals = 0,
  durationMs = 900,
  format,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  format?: (v: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    fromRef.current = value;
    if (reduce || from === value) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  const text = format
    ? format(shown)
    : shown.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span aria-label={format ? format(value) : value.toLocaleString("es-ES")}>{text}</span>;
}
