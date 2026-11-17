"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pill } from "@/components/ui/primitives";
import { bytes, duration, int, km, pace } from "@/lib/format";
import type { CheckRun, ImportView } from "@/lib/import/status";

type Resp = { import: ImportView; check: CheckRun | null; error?: string };

const PHASES: { id: string; label: string; detail: string }[] = [
  { id: "upload", label: "Subida", detail: "El zip va directo a tu almacén privado." },
  { id: "index", label: "Índice del zip", detail: "Localiza export.xml y las rutas GPX." },
  { id: "workouts", label: "Carreras y VO₂ máx.", detail: "1.ª lectura del XML. Descarta lo que no es correr." },
  { id: "samples", label: "Pulso, potencia y distancia", detail: "2.ª lectura: muestras dentro de cada carrera." },
  { id: "series", label: "Series", detail: "Ordena las muestras por carrera." },
  { id: "routes", label: "Rutas", detail: "GPX a Blob, mapa simplificado y parciales." },
  { id: "finalize", label: "Revisión", detail: "Duplicados, validez y sesiones especiales." },
];
const ORDER = PHASES.map((p) => p.id);

/** Mantiene la pantalla encendida mientras se procesa (si el navegador lo permite). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => {});
    acquire();
    const onVis = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export function ImportFlow({ initial, initialCheck }: { initial: ImportView | null; initialCheck: CheckRun | null }) {
  const [imp, setImp] = useState<ImportView | null>(initial);
  const [check, setCheck] = useState<CheckRun | null>(initialCheck);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(initial === null || initial.status === "done");
  const stop = useRef(false);
  useWakeLock(running);

  const process = useCallback(async (id: string) => {
    setRunning(true);
    setError(null);
    stop.current = false;
    let failures = 0;
    try {
      while (!stop.current) {
        const res = await fetch(`/api/import/${id}/step`, { method: "POST" }).catch(() => null);
        if (!res || !res.ok) {
          // Corte de red o función caída: el punto de control está guardado; se reintenta.
          if (++failures > 4) throw new Error("Se ha perdido la conexión. Pulsa «Continuar» para reanudar.");
          await new Promise((r) => setTimeout(r, 3000 * failures));
          continue;
        }
        failures = 0;
        const data = (await res.json()) as Resp;
        setImp(data.import);
        setCheck(data.check);
        if (data.import.status === "done") break;
        if (data.import.status === "failed") throw new Error(data.import.error ?? "La importación ha fallado");
        // Otra invocación tiene la reserva: espera un poco antes de volver a pedir.
        if (data.import.status === "processing") await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const onFile = async (file: File) => {
    setError(null);
    setFresh(false);
    setImp(null);
    setCheck(null);
    setUploadPct(0);
    try {
      const blob = await upload(`imports/${file.name.replace(/[^\w.\-]+/g, "_") || "export.zip"}`, file, {
        access: "private",
        handleUploadUrl: "/api/import/upload",
        multipart: true,
        contentType: "application/zip",
        onUploadProgress: (p) => setUploadPct(p.percentage),
      });
      setUploadPct(100);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: blob.url, pathname: blob.pathname, fileName: file.name }),
      });
      const created = (await res.json()) as ImportView & { error?: string };
      if (!res.ok) throw new Error(created.error ?? "No se pudo registrar la importación");
      setImp(created);
      setUploadPct(null);
      await process(created.id);
    } catch (e) {
      setUploadPct(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const current = uploadPct !== null ? "upload" : imp?.phase === "done" ? "done" : (imp?.phase ?? "upload");
  const currentIdx = current === "done" ? ORDER.length : ORDER.indexOf(current);
  const xmlPass = imp && (imp.phase === "workouts" || imp.phase === "samples") && imp.bytesTotal;
  const pct = uploadPct ?? (xmlPass ? Math.min(100, (100 * imp!.bytesProcessed) / imp!.bytesTotal!) : null);
  const done = imp?.status === "done";
  const resumable = imp && !done && !running && uploadPct === null;

  return (
    <div className="flex flex-col gap-4">
      {(fresh || done) && uploadPct === null && !running && (
        <section className="card card-hero p-5">
          <div className="eyebrow">{done ? "Nueva importación" : "Sube tu export"}</div>
          <p className="relative mt-3 text-[15px] leading-relaxed text-fg">
            En el iPhone: Salud → tu foto → <span className="font-semibold">Exportar todos los datos de salud</span>.
            Guarda el .zip en Archivos y elígelo aquí. Reimportar no duplica nada.
          </p>
          <label className="relative mt-5 inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-lime px-5 text-[16px] font-semibold text-lime-ink shadow-[0_8px_30px_-8px_rgba(200,242,58,0.55)] transition active:scale-[0.98]">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0-5 5m5-5 5 5M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Elegir el .zip
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </section>
      )}

      {(imp || uploadPct !== null) && !done && (
        <section className="card card-hero p-5" aria-live="polite">
          <div className="flex items-center justify-between">
            <div className="eyebrow">{running || uploadPct !== null ? "Importando" : "Importación en pausa"}</div>
            {imp?.fileSize ? <Pill>{bytes(imp.fileSize)}</Pill> : null}
          </div>
          <div className="relative mt-4 flex items-baseline gap-2">
            <span className="num text-[56px] text-fg">{pct === null ? "—" : Math.floor(pct)}</span>
            {pct !== null && <span className="text-[15px] font-medium text-fg-2">%</span>}
          </div>
          <p className="relative mt-1 text-[14px] text-fg-2">
            {PHASES.find((p) => p.id === current)?.label ?? ""}
            {xmlPass ? ` · ${bytes(imp!.bytesProcessed)} de ${bytes(imp!.bytesTotal)}` : ""}
          </p>
          <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <div
              className="h-full rounded-full bg-lime shadow-[0_0_14px_rgba(200,242,58,0.7)] transition-[width] duration-700"
              style={{ width: `${pct ?? 4}%` }}
            />
          </div>
          {running && (
            <p className="relative mt-4 text-[12px] text-fg-2">
              Mantén esta pantalla abierta. Si se corta, se reanuda donde iba.
            </p>
          )}
          {resumable && (
            <button
              type="button"
              onClick={() => void process(imp!.id)}
              className="relative mt-5 min-h-[52px] w-full rounded-2xl bg-lime text-[16px] font-semibold text-lime-ink transition active:scale-[0.98]"
            >
              Continuar importación
            </button>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="card border-[rgba(255,138,115,0.35)] p-4 text-[14px] text-danger">
          {error}
        </p>
      )}

      {(imp || uploadPct !== null) && (
        <section className="card p-5">
          <div className="eyebrow">Fases</div>
          <ol className="mt-4 flex flex-col gap-3.5">
            {PHASES.map((p, i) => {
              const state = i < currentIdx ? "done" : i === currentIdx ? "now" : "todo";
              return (
                <li key={p.id} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-bold ${
                      state === "done"
                        ? "bg-lime text-lime-ink"
                        : state === "now"
                          ? "border-2 border-lime text-lime shadow-[0_0_12px_rgba(200,242,58,0.5)]"
                          : "border border-line-strong text-fg-3"
                    }`}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-[15px] font-semibold ${state === "todo" ? "text-fg-3" : "text-fg"}`}>
                      {p.label}
                      <span className="sr-only">{state === "done" ? " (hecho)" : state === "now" ? " (en curso)" : ""}</span>
                    </div>
                    <div className="text-[12px] text-fg-2">{p.detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {imp && <Counters imp={imp} />}
      {done && <Check run={check} />}
    </div>
  );
}

function Counters({ imp }: { imp: ImportView }) {
  const s = imp.stats;
  const items: [string, number | undefined][] = [
    ["Entrenamientos leídos", s.workoutsSeen],
    ["Carreras encontradas", s.runsFound],
    ["Válidas", s.runsValid],
    ["Duplicadas (Strava)", s.runsDuplicate],
    ["No válidas (< 0,5 km)", s.runsInvalid],
    ["Sesiones especiales", s.runsSpecial],
    ["Rutas GPX enlazadas", (s.routesLinked ?? 0) + (s.routesTimeLinked ?? 0) || undefined],
    ["Lecturas de VO₂ máx.", s.vo2Readings],
    ["Muestras del reloj (FC, potencia, distancia)", s.samples],
  ];
  return (
    <section className="card p-5">
      <div className="eyebrow">Resumen</div>
      <dl className="mt-3 divide-y divide-white/6">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between py-2.5">
            <dt className="text-[14px] text-fg-2">{k}</dt>
            <dd className={`num text-[18px] ${v === undefined ? "text-fg-3" : "text-fg"}`}>{v === undefined ? "—" : int(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Comprobación con los valores conocidos de la carrera del 17‑oct‑2026. */
function Check({ run }: { run: CheckRun | null }) {
  const rows: [string, string, string][] = run
    ? [
        ["Distancia", `${km(run.distanceM)} km`, "21,34 km"],
        ["Tiempo", duration(run.durationS), "1:41:41"],
        ["Ritmo", `${pace(run.avgPaceSPerKm)} /km`, "4:46 /km"],
        ["FC media", run.avgHr === null ? "—" : `${int(run.avgHr)} ppm`, "156 ppm"],
        ["Potencia", run.avgPowerW === null ? "—" : `${int(run.avgPowerW)} W`, "252 W"],
      ]
    : [];
  return (
    <section className="card p-5">
      <div className="eyebrow">Comprobación · 17 oct 2026</div>
      {!run ? (
        <p className="mt-3 text-[14px] text-fg-2">No hay ninguna carrera válida ese día en los datos importados.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/6">
          {rows.map(([k, got, want]) => {
            const ok = got === want;
            return (
              <li key={k} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[14px] text-fg-2">{k}</span>
                <span className="flex items-center gap-2">
                  <span className="num text-[18px]">{got}</span>
                  <span className={`text-[12px] font-semibold ${ok ? "text-lime" : "text-danger"}`}>{ok ? "✓" : `esperado ${want}`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
