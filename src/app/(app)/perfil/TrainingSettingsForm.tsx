"use client";

import { useActionState, useState } from "react";
import { saveTrainingSettings, type SettingsState } from "@/app/(app)/actividad/actions";
import { limitsFrom, type HrZones, type ZoneMethod } from "@/lib/analysis/hr-zones";
import type { TypeSettings } from "@/lib/analysis/session-type";

const field =
  "h-11 w-full rounded-xl border border-line-strong bg-inset px-3 text-right text-[16px] text-fg outline-none focus:border-lime";

/**
 * Ajustes de entrenamiento: zonas de FC (5 límites editables) y umbrales de tipos.
 * Un solo botón guarda y recalcula todo (zonas, carga y tipos automáticos).
 */
export function TrainingSettingsForm({ zones, types }: { zones: HrZones; types: TypeSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveTrainingSettings, {});
  const [maxHr, setMaxHr] = useState(String(zones.maxHr));
  const [restHr, setRestHr] = useState(String(zones.restHr));
  const [method, setMethod] = useState<ZoneMethod>(zones.method);
  const [limits, setLimits] = useState(zones.limits.map(String));

  const recompute = (m = method, mx = maxHr, rs = restHr) => {
    const a = Number(mx);
    const b = Number(rs);
    if (a > b && a <= 240 && b >= 25) setLimits(limitsFrom(a, b, m).map(String));
  };

  return (
    <form action={action} className="card flex flex-col gap-4 p-5">
      <div>
        <div className="eyebrow">Zonas de frecuencia cardíaca</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Límite inferior de cada zona en ppm. Puedes escribirlos a mano o calcularlos con tu pulso máximo y en reposo.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
          Pulso máximo
          <input name="maxHr" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-fg-2">
          Pulso en reposo
          <input name="restHr" inputMode="numeric" value={restHr} onChange={(e) => setRestHr(e.target.value)} className={field} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[12px] text-fg-2">Método</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {(
            [
              ["reserve", "Reserva cardíaca"],
              ["max", "% del máximo"],
            ] as const
          ).map(([m, label]) => (
            <label
              key={m}
              className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border text-[13px] font-semibold ${
                method === m ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg"
              }`}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => {
                  setMethod(m);
                  recompute(m);
                }}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        onClick={() => recompute()}
        className="min-h-[44px] rounded-xl border border-line-strong text-[13px] font-semibold text-fg-2 active:scale-[0.98]"
      >
        Calcular límites ({method === "reserve" ? "50/60/70/80/90 % de la reserva" : "50/60/70/80/90 % del máximo"})
      </button>
      <div className="grid grid-cols-5 gap-2">
        {limits.map((v, i) => (
          <label key={i} className="flex flex-col items-center gap-1.5 text-[12px] font-semibold" style={{ color: `var(--z${i + 1})` }}>
            Z{i + 1}
            <input
              name={`z${i + 1}`}
              inputMode="numeric"
              value={v}
              onChange={(e) => setLimits((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
              className={`${field} px-1 text-center`}
              aria-label={`Límite inferior de la zona ${i + 1}`}
            />
          </label>
        ))}
      </div>

      <div className="mt-2 border-t border-line pt-4">
        <div className="eyebrow">Tipos de sesión</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Series: el reloj marcó 5 o más pasos con repeticiones. Cinta: indoor. Con pulso, Z1 → Recuperación, Z2 → Rodaje, Z3 o
          más con ritmo ≥ 4 % más rápido que tu media → Tempo. Competición, solo a mano.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span>Tirada larga desde</span>
            <span className="flex items-center gap-2">
              <input name="longRunKm" inputMode="decimal" defaultValue={String(types.longRunKm).replace(".", ",")} className={`${field} w-[84px]`} />
              <span className="w-[40px] text-fg-2">km</span>
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 text-[14px]">
            <span>Trail desde</span>
            <span className="flex items-center gap-2">
              <input name="trailMPerKm" inputMode="numeric" defaultValue={String(types.trailMPerKm)} className={`${field} w-[84px]`} />
              <span className="w-[40px] text-fg-2">m/km</span>
            </span>
          </label>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-[14px] text-danger">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-[14px] text-fg">
          Guardado. {state.ok}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-[52px] rounded-2xl bg-lime text-[16px] font-semibold text-lime-ink transition active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Recalculando…" : "Guardar y recalcular"}
      </button>
      <p className="text-[12px] text-fg-3">Recalcula zonas, carga y tipos automáticos de todas las carreras. Los tipos elegidos a mano no cambian.</p>
    </form>
  );
}
