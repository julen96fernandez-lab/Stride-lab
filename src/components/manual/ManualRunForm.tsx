"use client";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { useActionToast } from "@/components/ui/Toaster";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { manualRunAction, type ManualState } from "@/app/(app)/actividad/manual-actions";
import { ActivityFileError, parseActivityFile } from "@/lib/import/activity-file";
import { dateToMadrid } from "@/lib/manual/manual";
import type { ManualValues } from "@/lib/manual/form-values";
import { FeelingFields } from "@/components/feelings/FeelingFields";
import type { Feeling } from "@/lib/feelings/feelings";
export { emptyValues, type ManualValues } from "@/lib/manual/form-values";
import { SESSION_TYPES, TYPE_META } from "@/lib/analysis/session-type";

const field =
  "h-12 w-full rounded-xl border border-line-strong bg-inset px-3 text-[17px] text-fg outline-none focus:border-lime aria-[invalid=true]:border-danger";
const label = "flex flex-col gap-1.5 text-[12px] font-semibold text-fg-2";

const paceStr = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const dec = (n: number, d = 1) => n.toLocaleString("es-ES", { maximumFractionDigits: d });
const when = (d: Date | string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

/** Formulario de carrera manual (nueva o edición). */
export function ManualRunForm({
  initial,
  id,
  existingFile,
  initialFeeling,
}: {
  initial: ManualValues;
  id?: string;
  existingFile?: string | null;
  initialFeeling?: Feeling | null;
}) {
  const [state, action] = useActionState<ManualState, FormData>(manualRunAction, {});
  useActionToast(state);
  const [v, setV] = useState<ManualValues>(initial);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof ManualValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const err = state.errors ?? {};

  // Al elegir un archivo se lee en el móvil y se rellena lo que traiga (no se pisa lo ya escrito
  // salvo fecha, distancia y duración, que son las del archivo).
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileErr(null);
    setFileInfo(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      setFileErr("El archivo pasa de 4 MB. Expórtalo en .fit o sin fotos.");
      return;
    }
    try {
      const a = parseActivityFile(f.name, new Uint8Array(await f.arrayBuffer()));
      const s = a.summary;
      const dur = s.durationS ?? 0;
      const { date, time } = s.startAt ? dateToMadrid(s.startAt) : { date: v.date, time: v.time };
      const r = (n: number | null, d = 0) => (n === null ? "" : n.toFixed(d).replace(".", ","));
      setV((x) => ({
        ...x,
        date,
        time,
        distanceKm: s.distanceM ? (s.distanceM / 1000).toFixed(2).replace(".", ",") : x.distanceKm,
        h: dur ? String(Math.floor(dur / 3600)) : x.h,
        m: dur ? String(Math.floor((dur % 3600) / 60)) : x.m,
        s: dur ? String(Math.round(dur % 60) % 60) : x.s,
        avgHr: x.avgHr || r(s.avgHr),
        maxHr: x.maxHr || r(s.maxHr),
        elevationGainM: x.elevationGainM || r(s.elevationGainM),
        cadenceSpm: x.cadenceSpm || r(s.avgCadence),
        avgPowerW: x.avgPowerW || r(s.avgPower),
        isIndoor: s.hasGps ? x.isIndoor : true,
      }));
      const parts = [
        `${a.points.length.toLocaleString("es-ES")} puntos`,
        s.hasGps ? "ruta" : "sin GPS",
        a.points.some((p) => p.hr !== null) ? "pulso" : "sin pulso",
        a.points.some((p) => p.ele !== null) ? "altitud" : null,
        a.points.some((p) => p.power !== null) ? "potencia" : null,
      ].filter(Boolean);
      setFileInfo(`${f.name} · ${parts.join(" · ")}`);
    } catch (ex) {
      setFileErr(ex instanceof ActivityFileError ? ex.message : "No se pudo leer el archivo.");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const p = state.preview;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="confirm" value={confirm ? "1" : ""} />

      {/* Archivo opcional */}
      <section className="card flex flex-col gap-3 p-5">
        <div className="eyebrow">Archivo (opcional)</div>
        <p className="text-[13px] leading-relaxed text-fg-2">
          Un .gpx, .tcx o .fit exportado de Strava u otra app añade la ruta, la altitud y la curva de pulso, y rellena el formulario.
        </p>
        <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-2xl border border-dashed border-line-strong text-[15px] font-semibold text-fg-2">
          {fileInfo ? "Cambiar archivo" : "Elegir archivo"}
          <input ref={fileRef} type="file" name="file" accept=".gpx,.tcx,.fit,application/gpx+xml,application/octet-stream" onChange={onFile} className="sr-only" />
        </label>
        {fileInfo && <p className="text-[13px] text-fg">{fileInfo}</p>}
        {(fileErr || err.file) && (
          <p role="alert" className="text-[13px] text-danger">
            {fileErr ?? err.file}
          </p>
        )}
        {existingFile && !fileInfo && (
          <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
            <input type="checkbox" name="removeFile" className="h-4 w-4 accent-[var(--lime)]" /> Quitar los datos de {existingFile}
          </label>
        )}
      </section>

      {/* Obligatorios */}
      <section className="card flex flex-col gap-4 p-5">
        <div className="eyebrow">Carrera</div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Fecha
            <input type="date" name="date" value={v.date} onChange={set("date")} required aria-invalid={!!err.date} className={field} />
          </label>
          <label className={label}>
            Hora de inicio
            <input type="time" name="time" value={v.time} onChange={set("time")} required aria-invalid={!!err.date} className={field} />
          </label>
        </div>
        {err.date && <Err>{err.date}</Err>}
        <label className={label}>
          Distancia (km)
          <input
            name="distanceKm"
            inputMode="decimal"
            placeholder="10,0"
            value={v.distanceKm}
            onChange={set("distanceKm")}
            aria-invalid={!!err.distanceM}
            className={field}
          />
        </label>
        {err.distanceM && <Err>{err.distanceM}</Err>}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[12px] font-semibold text-fg-2">Duración (h : min : s)</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {(["h", "m", "s"] as const).map((k) => (
              <input
                key={k}
                name={k}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={k === "h" ? "0" : "00"}
                aria-label={k === "h" ? "Horas" : k === "m" ? "Minutos" : "Segundos"}
                value={v[k]}
                onChange={set(k)}
                aria-invalid={!!err.duration}
                className={`${field} text-center`}
              />
            ))}
          </div>
        </fieldset>
        {err.duration && <Err>{err.duration}</Err>}
        <label className="flex min-h-[44px] items-center gap-2.5 text-[15px]">
          <input type="checkbox" name="isIndoor" checked={v.isIndoor} onChange={set("isIndoor")} className="h-5 w-5 accent-[var(--lime)]" />
          Cinta / indoor
        </label>
        <label className={label}>
          Tipo de sesión
          <select name="sessionType" value={v.sessionType} onChange={set("sessionType")} className={field}>
            <option value="auto">Automático</option>
            {SESSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Opcionales */}
      <section className="card flex flex-col gap-4 p-5">
        <div className="eyebrow">Más datos (opcional)</div>
        <div className="grid grid-cols-2 gap-3">
          <Num name="avgHr" label="Pulso medio" unit="ppm" v={v} set={set} err={err.avgHr} />
          <Num name="maxHr" label="Pulso máximo" unit="ppm" v={v} set={set} err={err.maxHr} />
          <Num name="elevationGainM" label="Desnivel +" unit="m" v={v} set={set} err={err.elevationGainM} />
          <Num name="cadenceSpm" label="Cadencia" unit="pasos/min" v={v} set={set} err={err.cadenceSpm} />
          <Num name="avgPowerW" label="Potencia media" unit="W" v={v} set={set} err={err.avgPowerW} />
          <Num name="temperatureC" label="Temperatura" unit="°C" v={v} set={set} err={err.temperatureC} signed />
        </div>
      </section>

      {/* Sensaciones (opcional): se guardan con la carrera */}
      <FeelingFields initial={initialFeeling} />
      {err.feeling && <Err>{err.feeling}</Err>}

      {/* Vista previa */}
      {p && (
        <section className="card p-5" aria-live="polite">
          <div className="eyebrow">Vista previa</div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Box label="Ritmo medio" value={`${paceStr(p.paceSPerKm)} /km`} />
            <Box label="Tipo" value={TYPE_META[p.type as keyof typeof TYPE_META]?.label ?? p.type} note={p.typeIsManual ? "elegido a mano" : p.typeReason} />
            <Box label="Carga" value={p.load === null ? "—" : String(Math.round(p.load))} note={p.load === null ? "sin pulso" : p.loadEstimated ? "estimada con el pulso medio" : "con la curva de pulso"} />
            <Box label="Sesión" value={p.status === "invalid" ? "No válida" : p.isSpecial ? "Especial" : "Normal"} note={p.status === "invalid" ? "menos de 0,5 km" : p.isSpecial ? "más de 8:00 /km: no cuenta en ritmos" : undefined} />
          </dl>
          {p.file && (
            <p className="mt-3 text-[12px] text-fg-2">
              Del archivo: {p.file.points.toLocaleString("es-ES")} puntos{p.file.hasGps ? ", ruta y altitud" : ""}
              {p.file.hasHr ? ", curva de pulso (zonas y carga reales)" : ""}
              {p.file.hasPower ? ", potencia" : ""}.
            </p>
          )}
          {!p.file && (
            <p className="mt-3 text-[12px] text-fg-2">Sin archivo: no habrá mapa, gráficos ni tiempo en zonas (no se inventan).</p>
          )}
          {p.duplicates.length > 0 && (
            <div role="alert" className="mt-4 rounded-2xl border border-danger/40 p-3.5">
              <p className="text-[14px] font-semibold">Ya hay {p.duplicates.length === 1 ? "una carrera" : `${p.duplicates.length} carreras`} a menos de 30 min:</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
                {p.duplicates.map((d) => (
                  <li key={d.id}>
                    <Link href={`/actividad/${d.id}`} className="underline underline-offset-2">
                      {when(d.startAt)} · {d.distanceM ? `${dec(d.distanceM / 1000, 2)} km` : "—"} · {d.source === "manual" ? "Manual" : d.source === "apple_watch" ? "Apple Watch" : "Otra fuente"}
                    </Link>
                  </li>
                ))}
              </ul>
              {state.needsConfirm && (
                <label className="mt-3 flex min-h-[44px] items-center gap-2.5 text-[14px]">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="h-5 w-5 accent-[var(--lime)]" />
                  Es otra carrera: guardarla igualmente
                </label>
              )}
            </div>
          )}
        </section>
      )}

      {state.error && (
        <p role="alert" className="text-[14px] text-danger">
          {state.error}
        </p>
      )}

      <div className="sticky bottom-[96px] z-10 grid grid-cols-2 gap-2">
        <SubmitButton name="intent" value="preview" variant="ghost" pending="Calculando…">
          Ver resumen
        </SubmitButton>
        <SubmitButton name="intent" value="save" pending="Guardando…" disabled={!!state.needsConfirm && !confirm}>
          {id ? "Guardar cambios" : "Guardar"}
        </SubmitButton>
      </div>
    </form>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="-mt-2 text-[13px] text-danger">
      {children}
    </p>
  );
}

function Num({
  name,
  label: l,
  unit,
  v,
  set,
  err,
  signed,
}: {
  name: keyof ManualValues;
  label: string;
  unit: string;
  v: ManualValues;
  set: (k: keyof ManualValues) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  err?: string;
  signed?: boolean;
}) {
  return (
    <label className={label}>
      <span>
        {l} <span className="font-normal">({unit})</span>
      </span>
      <input
        name={name}
        inputMode={signed ? "text" : "decimal"}
        placeholder="—"
        value={v[name] as string}
        onChange={set(name)}
        aria-invalid={!!err}
        className={field}
      />
      {err && <span role="alert" className="text-[12px] font-normal text-danger">{err}</span>}
    </label>
  );
}

function Box({ label: l, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-inset p-3">
      <dt className="text-[11px] text-fg-2">{l}</dt>
      <dd className="num mt-1 text-[19px]">{value}</dd>
      {note && <div className="mt-0.5 text-[11px] leading-snug text-fg-2">{note}</div>}
    </div>
  );
}
