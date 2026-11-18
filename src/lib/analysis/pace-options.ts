import type { PaceRange } from "./insights";
import type { SessionType } from "./session-type";

/** Opciones de «Evolución del ritmo» (las usan el servidor y el cliente). */
export const PACE_RANGES: [PaceRange, string][] = [
  ["1m", "1 mes"],
  ["3m", "3 meses"],
  ["6m", "6 meses"],
  ["1y", "1 año"],
  ["all", "Todo"],
];
export const PACE_TYPES: (SessionType | null)[] = [null, "rodaje", "series", "tempo", "tirada_larga", "recuperacion", "trail", "cinta", "competicion"];
