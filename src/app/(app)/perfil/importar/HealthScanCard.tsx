"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import type { HealthScanView } from "@/lib/health/census-run";

type Resp = { scan: HealthScanView | null; error?: string };

const n = (x: number) => x.toLocaleString("es-ES");
const fmt = (ymd: string | null) =>
  ymd
    ? new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T12:00:00Z`)).replace(".", "")
    : "—";

/**
 * «Revisar datos de salud»: lee el zip ya guardado y solo cuenta lo que trae (HRV, reposo,
 * sueño, temperatura y pasos dentro de las carreras). No guarda ninguna lectura.
 */
export function HealthScanCard({ initial }: { initial: HealthScanView | null }) {
  const [scan, setScan] = useState<HealthScanView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (id: string) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    let failures = 0;
    try {
      while (!ctrl.signal.aborted) {
        const res = await fetch(`/api/health-scan/${id}/step`, { method: "POST", signal: ctrl.signal }).catch((e) => {
          if (ctrl.signal.aborted) throw e;
          return null;
        });
        if (!res || !res.ok) {
          if (res?.status === 401) throw new Error("La sesión ha caducado: vuelve a entrar y pulsa «Continuar».");
          if (++failures > 4) throw new Error("Se ha perdido la conexión con el servidor.");
          await new Promise((r) => setTimeout(r, 3000 * failures));
          continue;
        }
        failures = 0;
        const data = (await res.json()) as Resp;
        if (data.scan) setScan(data.scan);
        if (data.scan?.status === "done") {
          toast.success("Revisión terminada. No se ha guardado nada.");
          break;
        }
        if (data.scan?.status === "failed") throw new Error(data.scan.error ?? "La revisión ha fallado.");
        if (data.scan?.status === "processing") await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        toast.error("La revisión se ha detenido.");
      }
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  const start = async () => {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/health-scan", { method: "POST" }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as Resp) : null;
    if (!res?.ok || !data?.scan) {
      setBusy(false);
      setError(data?.error ?? "No se pudo empezar la revisión.");
      return;
    }
    setScan(data.scan);
    void run(data.scan.id);
  };

  const unfinished = scan && scan.status !== "done";
  const s = scan?.status === "done" ? scan.summary : null;

  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Revisar datos de salud">
      <div>
        <div className="eyebrow">Revisar datos de salud</div>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          Lee el zip ya guardado (sin volver a subirlo) y solo cuenta qué trae: variabilidad cardíaca, pulso en reposo, sueño, temperatura de
          muñeca y pasos dentro de las carreras. No guarda ninguna lectura.
        </p>
      </div>

      {busy && scan && (
        <div aria-live="polite">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="flex items-center gap-2">
              <Spinner size={14} /> Leyendo el zip…
            </span>
            <span className="num">{Math.floor(scan.pct * 100)} %</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ov-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(scan.pct * 100)}>
            <div className="h-full rounded-full bg-lime transition-[width] duration-700" style={{ width: `${Math.max(2, scan.pct * 100)}%` }} />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {!busy && (
        <button
          type="button"
          onClick={() => (unfinished && scan.status !== "failed" ? run(scan.id) : start())}
          className="min-h-[48px] w-full rounded-2xl bg-lime text-[15px] font-semibold text-lime-ink"
        >
          {unfinished && scan.status !== "failed" ? "Continuar la revisión" : s ? "Revisar otra vez" : "Revisar datos de salud"}
        </button>
      )}

      {s && scan && (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-fg-2">
            Revisado el {fmt(scan.finishedAt?.slice(0, 10) ?? null)} · export del {fmt(scan.exportDay)}. «Últimos 28 días» = los 28 días que acaban en la fecha del
            export.
          </p>
          <ul className="flex flex-col gap-2.5">
            {s.kinds.map((k) => (
              <li key={k.kind} className="rounded-2xl border border-line bg-inset p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold">{k.label}</span>
                  <span className="num flex-none text-[17px]">{n(k.total)}</span>
                </div>
                {k.total === 0 ? (
                  <p className="mt-1 text-[12px] text-fg-2">El zip no trae ninguna lectura.</p>
                ) : (
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                    <dt className="text-fg-2">Fuente</dt>
                    <dd className="break-words">
                      Watch {n(k.watch)} · iPhone {n(k.phone)} · otras {n(k.other)}
                    </dd>
                    <dt className="text-fg-2">Fechas</dt>
                    <dd>
                      <span className="whitespace-nowrap">{fmt(k.first)}</span> → <span className="whitespace-nowrap">{fmt(k.last)}</span>
                    </dd>
                    <dt className="text-fg-2">Días (Watch)</dt>
                    <dd>
                      {n(k.watchDays)} · <span className="whitespace-nowrap">últimos 28 días: {k.last28} de 28</span>
                    </dd>
                  </dl>
                )}
                {k.kind === "sleep" && s.sleepStages.length > 0 && (
                  <p className="mt-1.5 text-[12px] break-words text-fg-2">Fases (Watch): {s.sleepStages.map((x) => `${x.label} ${n(x.n)}`).join(" · ")}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[13px]">
            Días con HRV, reposo y sueño del Watch a la vez: <b className="num">{n(s.allThreeDays)}</b> ({s.allThreeLast28} de los últimos 28).
          </p>
          <div className="rounded-2xl border border-line bg-inset p-3.5">
            <div className="text-[14px] font-semibold">Pasos dentro de las carreras (cadencia)</div>
            <p className="mt-1 text-[12px] leading-relaxed">
              {n(s.steps.runsWithSteps)} de {n(s.steps.runsTotal)} carreras válidas del Watch traen pasos ({n(s.steps.samples)} registros)
              {s.steps.medianGapS !== null ? `; llegan cada ${n(Math.round(s.steps.medianGapS))} s (mediana)` : ""}.
            </p>
            {s.steps.runsWithSteps > 0 && (
              <p className="mt-1 text-[12px] text-fg-2">Carreras según cada cuánto llegan: {s.steps.byGap.map((b) => `${b.label}: ${n(b.runs)}`).join(" · ")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
