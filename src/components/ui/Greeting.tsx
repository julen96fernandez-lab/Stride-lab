"use client";

import { useSyncExternalStore } from "react";

const TZ = "Europe/Madrid";

function snapshot(): string {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("es-ES", { hour: "numeric", hour12: false, timeZone: TZ }).format(now));
  const greeting = hour >= 6 && hour < 14 ? "Buenos días" : hour >= 14 && hour < 21 ? "Buenas tardes" : "Buenas noches";
  const date = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "short", timeZone: TZ })
    .format(now)
    .replace(".", "");
  return `${greeting}|${date.charAt(0).toUpperCase()}${date.slice(1)}`;
}
const subscribe = () => () => {};

/** Fecha de hoy en hora de Madrid, calculada en el cliente. */
export function TodayLabel() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "|");
  return (
    <span className="text-[13px] font-medium text-fg-2" suppressHydrationWarning>
      {value.split("|")[1]}
    </span>
  );
}

/** Saludo según la hora de Madrid. */
export function GreetingTitle() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "Hola|");
  return (
    <h1 className="font-display text-[38px] leading-[1.04] font-bold tracking-[-0.035em]" suppressHydrationWarning>
      {value.split("|")[0]}
    </h1>
  );
}
