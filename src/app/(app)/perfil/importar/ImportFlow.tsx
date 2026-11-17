"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pill } from "@/components/ui/primitives";
import { bytes, date, duration, int, km, pace } from "@/lib/format";
import type { CheckRun, ImportView } from "@/lib/import/status";
import { blobUploadApi } from "@/lib/upload/blob-api";
import {
  clearSaved,
  loadSaved,
  resumableUpload,
  sameFile,
  savedBytes,
  type SavedUpload,
  type UploadProgress,
} from "@/lib/upload/resumable";
import type { StoredZip } from "@/app/api/import/blobs/route";

type Resp = { import: ImportView; check: CheckRun | null; error?: string };

const STALL_MS = 60_000;
const POLL_MS = 4_000;

const PHASES: { id: string; label: string; detail: string }[] = [
  { id: "upload", label: "Subida", detail: "Por partes, directa a tu almacén privado. Se puede reanudar." },
  { id: "index", label: "Índice del zip", detail: "Localiza export.xml y las rutas GPX." },
  { id: "workouts", label: "Carreras y VO₂ máx.", detail: "1.ª lectura del XML. Descarta lo que no es correr." },
  { id: "samples", label: "Pulso, potencia y distancia", detail: "2.ª lectura: muestras dentro de cada carrera." },
  { id: "series", label: "Series", detail: "Ordena las muestras por carrera." },
  { id: "routes", label: "Rutas", detail: "GPX a Blob, mapa simplificado y parciales." },
  { id: "finalize", label: "Revisión", detail: "Duplicados, validez y sesiones especiales." },
];
const ORDER = PHASES.map((p) => p.id);
const UPLOAD_LABEL: Record<UploadProgress["phase"], string> = {
  preparing: "Preparando la subida",
  uploading: "Subiendo",
  joining: "Uniendo las partes en Blob",
  done: "Subido",
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Mantiene la pantalla encendida mientras se trabaja (si el navegador lo permite). */
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
    void acquire();
    const onVis = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

/** Reloj de 1 s para detectar paradas. */
const subscribeClock = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const useNow = () => useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 1000) * 1000, () => 0);

export function ImportFlow({ initial, initialCheck }: { initial: ImportView | null; initialCheck: CheckRun | null }) {
  const [imp, setImp] = useState<ImportView | null>(initial);
  const [check, setCheck] = useState<CheckRun | null>(initialCheck);
  const [up, setUp] = useState<UploadProgress | null>(null);
  const [mode, setMode] = useState<"idle" | "uploading" | "registering" | "processing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SavedUpload | null>(null);
  const [zips, setZips] = useState<StoredZip[] | null>(null);
  const [lastChange, setLastChange] = useState(() => Date.now());
  const fileRef = useRef<(File & { lastModified: number }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const now = useNow();
  const busy = mode !== "idle";
  useWakeLock(busy);

  const touch = useCallback(() => setLastChange(Date.now()), []);

  const refreshZips = useCallback(async () => {
    const res = await fetch("/api/import/blobs").catch(() => null);
    if (res?.ok) setZips(((await res.json()) as { zips: StoredZip[] }).zips);
    else setZips([]);
  }, []);

  useEffect(() => {
    // Lecturas iniciales del dispositivo y del almacén (efecto de montaje).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(loadSaved(storage()));
    void refreshZips();
  }, [refreshZips]);

  // ── Proceso del zip (pasos en bucle + sondeo del estado mientras dura cada paso) ──
  const process = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setMode("processing");
      setError(null);
      touch();
      let lastKey = "";
      const apply = (data: Resp) => {
        const k = JSON.stringify([data.import.phase, data.import.status, data.import.bytesProcessed, data.import.stats]);
        if (k !== lastKey) {
          lastKey = k;
          touch();
        }
        setImp(data.import);
        setCheck(data.check);
      };
      const poll = setInterval(async () => {
        const r = await fetch(`/api/import/${id}`, { signal: ctrl.signal }).catch(() => null);
        if (r?.ok) apply((await r.json()) as Resp);
      }, POLL_MS);
      let failures = 0;
      try {
        while (!ctrl.signal.aborted) {
          const res = await fetch(`/api/import/${id}/step`, { method: "POST", signal: ctrl.signal }).catch((e) => {
            if (ctrl.signal.aborted) throw e;
            return null;
          });
          if (!res || !res.ok) {
            if (res?.status === 401) throw new Error("La sesión ha caducado: vuelve a entrar y pulsa «Continuar».");
            // Corte de red o función caída: el punto de control está guardado; se reintenta.
            if (++failures > 4) throw new Error("Se ha perdido la conexión con el servidor.");
            await new Promise((r) => setTimeout(r, 3000 * failures));
            continue;
          }
          failures = 0;
          const data = (await res.json()) as Resp;
          apply(data);
          if (data.import.status === "done") break;
          if (data.import.status === "failed") throw new Error(data.import.error ?? "La importación ha fallado");
          // Otra invocación tiene la reserva: espera antes de volver a pedir.
          if (data.import.status === "processing") await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        clearInterval(poll);
        if (abortRef.current === ctrl) {
          setMode("idle");
          void refreshZips();
        }
      }
    },
    [refreshZips, touch],
  );

  // ── Crear la importación a partir de un zip que ya está en Blob ──
  const [lastReg, setLastReg] = useState<{ pathname: string; fileName: string | null; size?: number } | null>(null);
  const register = useCallback(
    async (pathname: string, fileName: string | null, size?: number) => {
      setLastReg({ pathname, fileName, size });
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setMode("registering");
      setError(null);
      touch();
      try {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pathname, fileName, size }),
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(45_000)]),
        }).catch((e: unknown) => {
          if (ctrl.signal.aborted) throw e;
          throw new Error("El servidor no responde al crear la importación. El zip ya está subido: pulsa «Reintentar».");
        });
        const created = (await res.json()) as ImportView & { error?: string };
        if (!res.ok) throw new Error(created.error ?? "No se pudo crear la importación");
        setImp(created);
        setCheck(null);
        await process(created.id);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setMode("idle");
        void refreshZips();
      }
    },
    [process, refreshZips, touch],
  );

  // ── Subida reanudable ──
  const startUpload = useCallback(
    async (file: File) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      fileRef.current = file;
      setError(null);
      setImp(null);
      setCheck(null);
      setMode("uploading");
      touch();
      let lastSent = -1;
      try {
        const blob = await resumableUpload(file, {
          api: blobUploadApi,
          store: storage(),
          signal: ctrl.signal,
          onProgress: (p) => {
            setUp(p);
            if (p.sent !== lastSent || p.phase !== "uploading") {
              lastSent = p.sent;
              touch();
            }
          },
        });
        setPending(null);
        fileRef.current = null;
        setUp(null);
        // Sin callbacks: el navegador crea la importación con el zip ya subido.
        await register(blob.pathname, file.name, file.size);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setPending(loadSaved(storage()));
        setError(
          `${e instanceof Error ? e.message : String(e)}. Lo ya subido se conserva: pulsa «Continuar la subida».`,
        );
        setMode("idle");
      }
    },
    [register, touch],
  );

  const onPick = (f: File | undefined) => {
    if (!f) return;
    if (pending && !sameFile(pending, f)) {
      const ok = window.confirm(
        `Has elegido otro archivo (${f.name}, ${bytes(f.size)}). La subida a medias de ${pending.fileName} se descartará. ¿Seguir?`,
      );
      if (!ok) return;
    }
    void startUpload(f);
  };

  const discardPending = () => {
    clearSaved(storage());
    setPending(null);
  };

  /** Reintento manual tras una parada: aborta lo que esté colgado y vuelve a empezar desde el último punto. */
  const retry = () => {
    if (mode === "uploading" && fileRef.current) void startUpload(fileRef.current);
    else if (mode === "registering" && lastReg) {
      void register(lastReg.pathname, lastReg.fileName, lastReg.size);
    } else if (imp && imp.status !== "done") void process(imp.id);
    else abortRef.current?.abort();
  };

  // ── Datos de pantalla ──
  const stalled = busy && now - lastChange > STALL_MS;
  const processingPhase = imp?.phase === "done" ? "done" : (imp?.phase ?? "index");
  const current = mode === "uploading" ? "upload" : imp ? processingPhase : "upload";
  const currentIdx = current === "done" ? ORDER.length : ORDER.indexOf(current);
  const xmlPass = imp && (imp.phase === "workouts" || imp.phase === "samples") && imp.bytesTotal ? imp : null;
  const done = imp?.status === "done";
  const resumableImport = imp && !done && mode === "idle";
  const unfinishedZips = (zips ?? []).filter((z) => z.importStatus !== "done");
  // Con una subida a medias pendiente, la pantalla se centra en ella.
  const showDetails = !(pending && mode === "idle");

  return (
    <div className="flex flex-col gap-4">
      {/* ── Subida a medias guardada en el iPhone ── */}
      {pending && mode === "idle" && (
        <section className="card card-hero p-5">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Subida a medias</div>
            <Pill tone="lime">{Math.floor((100 * savedBytes(pending)) / pending.fileSize)} %</Pill>
          </div>
          <p className="relative mt-3 text-[15px] leading-relaxed text-fg">
            <span className="font-semibold">{pending.fileName}</span>: {bytes(savedBytes(pending))} de{" "}
            {bytes(pending.fileSize)} ya en Blob. Faltan {bytes(pending.fileSize - savedBytes(pending))}.
          </p>
          <p className="relative mt-1 text-[13px] text-fg-2">
            Vuelve a elegir el mismo archivo: solo se envía lo que falta.
          </p>
          <FilePicker label="Continuar la subida" onPick={onPick} />
          <button type="button" onClick={discardPending} className="relative mt-2 min-h-[44px] w-full text-[14px] text-fg-2">
            Descartar y empezar de cero
          </button>
        </section>
      )}

      {/* ── Subir un zip nuevo ── */}
      {mode === "idle" && !pending && !resumableImport && (
        <section className="card card-hero p-5">
          <div className="eyebrow">{done ? "Nueva importación" : "Sube tu export"}</div>
          <p className="relative mt-3 text-[15px] leading-relaxed text-fg">
            En el iPhone: Salud → tu foto → <span className="font-semibold">Exportar todos los datos de salud</span>.
            Guarda el .zip en Archivos y elígelo aquí. Reimportar no duplica nada.
          </p>
          <FilePicker label="Elegir el .zip" onPick={onPick} />
        </section>
      )}

      {/* ── Progreso de la subida ── */}
      {mode === "uploading" && up && (
        <section className="card card-hero p-5" aria-live="polite">
          <div className="flex items-center justify-between">
            <div className="eyebrow">{UPLOAD_LABEL[up.phase]}</div>
            <Pill>
              Parte {Math.min(up.partsDone + (up.phase === "uploading" ? 1 : 0), up.partsTotal)} de {up.partsTotal}
            </Pill>
          </div>
          <BigPct value={(100 * up.sent) / Math.max(1, up.total)} />
          <dl className="relative mt-3 grid grid-cols-3 gap-2">
            <Mini label="Subido" value={bytes(up.sent)} />
            <Mini label="Faltan" value={bytes(up.total - up.sent)} />
            <Mini label="Total" value={bytes(up.total)} />
          </dl>
          <Bar pct={(100 * up.sent) / Math.max(1, up.total)} />
          {up.phase === "joining" && (
            <p className="relative mt-3 text-[13px] text-fg-2">Todo enviado. Blob está uniendo las partes (puede tardar un poco).</p>
          )}
          {up.retrying && <p className="relative mt-3 text-[13px] text-fg-2">{up.retrying}</p>}
          <p className="relative mt-3 text-[12px] text-fg-2">Mantén esta pantalla abierta. Si se corta, se reanuda donde iba.</p>
        </section>
      )}

      {mode === "registering" && (
        <section className="card card-hero p-5" aria-live="polite">
          <div className="eyebrow">Creando la importación</div>
          <p className="relative mt-3 text-[15px] text-fg">Comprobando el zip en Blob…</p>
        </section>
      )}

      {/* ── Progreso del proceso ── */}
      {showDetails && imp && !done && mode !== "uploading" && (
        <section className="card card-hero p-5" aria-live="polite">
          <div className="flex items-center justify-between">
            <div className="eyebrow">{mode === "processing" ? "Importando" : "Importación en pausa"}</div>
            {imp.fileSize ? <Pill>{bytes(imp.fileSize)}</Pill> : null}
          </div>
          <p className="relative mt-3 font-display text-[22px] font-bold tracking-[-0.02em]">
            {PHASES.find((p) => p.id === processingPhase)?.label ?? "Preparando"}
          </p>
          {xmlPass ? (
            <>
              <BigPct value={(100 * xmlPass.bytesProcessed) / xmlPass.bytesTotal!} />
              <p className="relative mt-1 text-[14px] text-fg-2">
                {bytes(xmlPass.bytesProcessed)} de {bytes(xmlPass.bytesTotal)} del XML leídos
              </p>
              <Bar pct={(100 * xmlPass.bytesProcessed) / xmlPass.bytesTotal!} />
            </>
          ) : (
            <p className="relative mt-1 text-[14px] text-fg-2">{phaseDetail(imp)}</p>
          )}
          {mode === "processing" && (
            <p className="relative mt-3 text-[12px] text-fg-2">
              Última novedad hace {Math.max(0, Math.round((now - lastChange) / 1000))} s. Puedes salir: lo hecho se guarda.
            </p>
          )}
          {resumableImport && <ActionButton onClick={() => void process(imp.id)} label="Continuar importación" />}
        </section>
      )}

      {/* ── Parada > 60 s ── */}
      {stalled && (
        <section className="card border-[rgba(255,138,115,0.35)] p-5" role="alert">
          <div className="eyebrow text-danger">Sin avances desde hace {Math.round((now - lastChange) / 1000)} s</div>
          <p className="mt-2 text-[14px] text-fg-2">
            {mode === "uploading"
              ? "La subida parece parada. Reintentar no repite lo ya subido."
              : mode === "registering"
                ? "El servidor tarda en crear la importación. El zip ya está subido."
                : "No llegan novedades del servidor. Continuar retoma desde el último punto guardado."}
          </p>
          <ActionButton
            onClick={retry}
            label={mode === "uploading" ? "Reintentar la subida" : mode === "registering" ? "Reintentar" : "Continuar"}
          />
        </section>
      )}

      {error && (
        <section role="alert" className="card border-[rgba(255,138,115,0.35)] p-4">
          <p className="text-[14px] text-danger">{error}</p>
          {imp && !done && mode === "idle" && <ActionButton onClick={() => void process(imp.id)} label="Reintentar" />}
          {!imp && lastReg && mode === "idle" && (
            <ActionButton onClick={() => void register(lastReg.pathname, lastReg.fileName, lastReg.size)} label="Reintentar" />
          )}
        </section>
      )}

      {/* ── Fases ── */}
      {showDetails && (imp || mode === "uploading") && (
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

      {showDetails && imp && mode !== "uploading" && <Counters imp={imp} />}
      {showDetails && done && mode === "idle" && <Check run={check} />}

      {/* ── Zips ya en Blob ── */}
      {mode === "idle" && unfinishedZips.length > 0 && (
        <section className="card p-5">
          <div className="eyebrow">Zips ya subidos</div>
          <p className="mt-2 text-[13px] text-fg-2">Crea la importación sin volver a subir el archivo.</p>
          <ul className="mt-3 divide-y divide-white/6">
            {unfinishedZips.map((z) => (
              <li key={z.pathname} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="num text-[17px]">{bytes(z.size)}</div>
                  <div className="text-[12px] text-fg-2">
                    Subido el {date(z.uploadedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {z.importStatus ? ` · importación ${STATUS_ES[z.importStatus] ?? z.importStatus}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => (z.importId ? void process(z.importId) : void register(z.pathname, null, z.size))}
                  className="min-h-[44px] flex-none rounded-xl bg-lime px-4 text-[14px] font-semibold text-lime-ink active:scale-[0.98]"
                >
                  {z.importId ? "Continuar" : "Usar este zip"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const STATUS_ES: Record<string, string> = { uploaded: "sin empezar", processing: "en curso", failed: "con error", done: "terminada" };

function phaseDetail(imp: ImportView): string {
  const s = imp.stats;
  switch (imp.phase) {
    case "index":
      return "Leyendo el índice del zip…";
    case "series":
      return `${int(s.seriesRuns ?? 0)} carreras con series listas`;
    case "routes":
      return `${int((s.routesLinked ?? 0) + (s.routesTimeLinked ?? 0))} rutas enlazadas de ${int(s.gpxFiles ?? null)} GPX`;
    case "finalize":
      return "Revisando duplicados y validez…";
    default:
      return "";
  }
}

function FilePicker({ label, onPick }: { label: string; onPick: (f: File | undefined) => void }) {
  return (
    <label className="relative mt-5 inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-lime px-5 text-[16px] font-semibold text-lime-ink shadow-[0_8px_30px_-8px_rgba(200,242,58,0.55)] transition active:scale-[0.98]">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 16V4m0 0-5 5m5-5 5 5M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
      <input
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function ActionButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative mt-4 min-h-[52px] w-full rounded-2xl bg-lime text-[16px] font-semibold text-lime-ink transition active:scale-[0.98]"
    >
      {label}
    </button>
  );
}

function BigPct({ value }: { value: number }) {
  return (
    <div className="relative mt-3 flex items-baseline gap-1.5">
      <span className="num text-[56px] text-fg">{Math.floor(Math.max(0, Math.min(100, value)))}</span>
      <span className="text-[15px] font-medium text-fg-2">%</span>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/8"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(v)}
    >
      <div
        className="h-full rounded-full bg-lime shadow-[0_0_14px_rgba(200,242,58,0.7)] transition-[width] duration-700"
        style={{ width: `${Math.max(2, v)}%` }}
      />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-black/20 px-3 py-2.5">
      <dt className="text-[11px] font-semibold tracking-[0.08em] text-fg-2 uppercase">{label}</dt>
      <dd className="num mt-1 text-[17px]">{value}</dd>
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
          <div key={k} className="flex items-baseline justify-between gap-3 py-2.5">
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
