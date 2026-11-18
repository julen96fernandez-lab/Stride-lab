"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { SubmitButton, Spinner } from "@/components/ui/SubmitButton";
import { useActionToast } from "@/components/ui/Toaster";
import { deleteRaceAction, saveRaceAction, type RaceState } from "@/app/(app)/plan/race-actions";
import { predictDistance, type Prediction, type Source } from "@/lib/plan/predict";
import { RACE_DISTANCES, REALISM_LABEL, fmtTime, parseTime, realism, type RaceDistanceKey, type Realism } from "@/lib/race/race";

const field = "h-11 w-full rounded-xl border border-line-strong bg-inset px-3 text-[16px] text-fg outline-none focus:border-lime";
const label = "flex flex-col gap-1.5 text-[13px] text-fg-2";

export const REALISM_COLOR: Record<Realism, string> = {
  realista: "var(--load-low)",
  conservador: "var(--t-rodaje)",
  ambicioso: "var(--load-mod)",
  muy_ambicioso: "var(--load-high)",
};

export interface RaceFormValues {
  id?: string;
  name: string;
  date: string;
  distanceKey: RaceDistanceKey;
  distanceKm: string;
  startTime: string;
  target: string;
  hasProfile: boolean;
  profileNote?: string | null;
}

/** Crear o editar una carrera objetivo. El tiempo por defecto es la predicción central de Plan. */
export function RaceForm({
  initial,
  preds,
  sources,
  longestM,
}: {
  initial: RaceFormValues;
  /** predicciones de Plan por distancia estándar */
  preds: Prediction[];
  sources: Source[];
  longestM: number;
}) {
  const [state, action] = useActionState<RaceState, FormData>(saveRaceAction, {});
  useActionToast(state);
  const err = state.errors ?? {};
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(!!initial.id);
  const set = <K extends keyof RaceFormValues>(k: K, val: RaceFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  const distanceM = v.distanceKey === "other" ? Number(v.distanceKm.replace(",", ".")) * 1000 : RACE_DISTANCES[v.distanceKey].m;
  const pred = useMemo(() => {
    if (!(distanceM > 0)) return null;
    return v.distanceKey !== "other" ? (preds.find((p) => p.key === v.distanceKey) ?? null) : predictDistance(distanceM, sources, longestM);
  }, [v.distanceKey, distanceM, preds, sources, longestM]);
  // Sin tocar el tiempo, sigue a la predicción de la distancia elegida.
  const shownTarget = !touched && pred ? fmtTime(Math.round(pred.timeS / 5) * 5) : v.target;
  const t = parseTime(shownTarget);
  const r = t !== null ? realism(t, pred) : null;

  const [deleting, startDelete] = useTransition();
  const [confirm, setConfirm] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <section className="card flex flex-col gap-4 p-5">
        <label className={label}>
          Nombre
          <input name="name" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={80} placeholder="Ej.: Media de Bilbao" className={field} />
        </label>
        {err.name && <Err>{err.name}</Err>}
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Fecha
            <input type="date" name="date" value={v.date} onChange={(e) => set("date", e.target.value)} className={field} />
          </label>
          <label className={label}>
            Hora de salida (opcional)
            <input type="time" name="startTime" value={v.startTime} onChange={(e) => set("startTime", e.target.value)} className={field} />
          </label>
        </div>
        {err.date && <Err>{err.date}</Err>}
        {err.startTime && <Err>{err.startTime}</Err>}
        <label className={label}>
          Distancia
          <select name="distanceKey" value={v.distanceKey} onChange={(e) => set("distanceKey", e.target.value as RaceDistanceKey)} className={field}>
            {Object.entries(RACE_DISTANCES).map(([k, d]) => (
              <option key={k} value={k}>
                {d.label}
              </option>
            ))}
            <option value="other">Otra (en km)</option>
          </select>
        </label>
        {v.distanceKey === "other" && (
          <label className={label}>
            Kilómetros
            <input name="distanceKm" inputMode="decimal" value={v.distanceKm} onChange={(e) => set("distanceKm", e.target.value)} placeholder="Ej.: 15" className={field} />
          </label>
        )}
        {err.distance && <Err>{err.distance}</Err>}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <label className={label}>
          Tiempo objetivo (h:mm:ss)
          <input
            name="target"
            inputMode="numeric"
            value={shownTarget}
            onChange={(e) => {
              setTouched(true);
              set("target", e.target.value);
            }}
            placeholder={pred ? fmtTime(pred.timeS) : "1:45:00"}
            className={`${field} num text-[22px]`}
          />
        </label>
        {err.target && <Err>{err.target}</Err>}
        {pred ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
            {r && <RealismPill r={r} />}
            <span>
              Predicción de Plan: ≈{fmtTime(pred.timeS)} (entre {fmtTime(pred.lowS)} y {fmtTime(pred.highS)}, confianza {pred.confidence}).
            </span>
          </div>
        ) : (
          <p className="text-[13px] text-fg-2">
            Sin predicción para esta distancia{distanceM >= 40_000 ? " (hace falta una tirada de 30 km o más)" : ""}: pon el tiempo que quieras; no se etiqueta.
          </p>
        )}
        {touched && pred && (
          <button type="button" onClick={() => (setTouched(false), set("target", ""))} className="min-h-[44px] self-start text-[13px] font-semibold text-fg-2 underline-offset-2 hover:underline">
            Volver a la predicción
          </button>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <div className="eyebrow">Recorrido (opcional)</div>
        <p className="text-[13px] text-fg-2">Un GPX del recorrido para el perfil de altitud. Se ajusta a la distancia oficial.</p>
        <input type="file" name="gpx" accept=".gpx,application/gpx+xml" className="text-[14px] file:mr-3 file:min-h-[44px] file:rounded-full file:border-0 file:bg-ov-2 file:px-4 file:font-semibold file:text-fg" />
        {v.hasProfile && (
          <>
            {v.profileNote && <p className="text-[12px] text-fg-2">{v.profileNote}</p>}
            <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
              <input type="checkbox" name="removeGpx" className="h-5 w-5 accent-[var(--lime)]" /> Quitar el recorrido actual
            </label>
          </>
        )}
        {err.gpx && <Err>{err.gpx}</Err>}
      </section>

      {state.error && <Err>{state.error}</Err>}
      <SubmitButton pending="Guardando…">{v.id ? "Guardar cambios" : "Guardar carrera"}</SubmitButton>
      {v.id && (
        <button
          type="button"
          disabled={deleting}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            startDelete(async () => {
              await deleteRaceAction(v.id!);
            });
          }}
          className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold ${confirm ? "border border-danger text-danger" : "border border-line-strong text-fg-2"}`}
        >
          {deleting && <Spinner />}
          {deleting ? "Borrando…" : confirm ? "Toca otra vez para borrar la carrera" : "Borrar carrera objetivo"}
        </button>
      )}
    </form>
  );
}

export function RealismPill({ r }: { r: Realism }) {
  const c = REALISM_COLOR[r];
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}
    >
      {REALISM_LABEL[r]}
    </span>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  );
}
