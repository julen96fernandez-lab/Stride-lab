import { dateToMadrid } from "./manual";

/** Valores del formulario de carrera manual (texto, tal como se escriben). */
export interface ManualValues {
  date: string;
  time: string;
  distanceKm: string;
  h: string;
  m: string;
  s: string;
  avgHr: string;
  maxHr: string;
  elevationGainM: string;
  cadenceSpm: string;
  avgPowerW: string;
  temperatureC: string;
  sessionType: string;
  isIndoor: boolean;
}

/** Formulario vacío con la fecha y hora de ahora (Madrid). */
export function emptyValues(now: Date = new Date()): ManualValues {
  const { date, time } = dateToMadrid(now);
  return {
    date,
    time,
    distanceKm: "",
    h: "",
    m: "",
    s: "",
    avgHr: "",
    maxHr: "",
    elevationGainM: "",
    cadenceSpm: "",
    avgPowerW: "",
    temperatureC: "",
    sessionType: "auto",
    isIndoor: false,
  };
}

