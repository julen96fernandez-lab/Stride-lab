"use client";

import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { BAND_H, BAND_W, bandLayout } from "@/lib/race/band";
import { STRATEGIES, pacePlan, type PaceRow, type Strategy } from "@/lib/race/pacing";
import { fmtTime, type RaceProfile } from "@/lib/race/race";

const pace = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Colores de la imagen (no dependen del tema de la pantalla: se eligen aparte). */
const PALETTE = {
  dark: { bg: "#0A0B09", card: "#151712", fg: "#F4F5EE", fg2: "#A9ACA2", line: "rgba(255,255,255,0.10)", accent: "#C8F23A", accentInk: "#0B0C0A" },
  light: { bg: "#F3F3EE", card: "#FFFFFF", fg: "#0B0C0A", fg2: "#5B5E55", line: "rgba(11,12,10,0.10)", accent: "#4A6B00", accentInk: "#FFFFFF" },
} as const;

/** Dibuja la banda en un lienzo del tamaño de la pantalla del iPhone. */
function drawBand(c: HTMLCanvasElement, o: { name: string; dateLine: string; target: string; strategy: string; rows: PaceRow[]; theme: "dark" | "light"; clock: boolean }) {
  const P = PALETTE[o.theme];
  c.width = BAND_W;
  c.height = BAND_H;
  const g = c.getContext("2d")!;
  const font = getComputedStyle(document.body).fontFamily;
  const display = getComputedStyle(document.documentElement).getPropertyValue("--font-space-grotesk").trim() || font;
  g.fillStyle = P.bg;
  g.fillRect(0, 0, BAND_W, BAND_H);
  const L = bandLayout(o.rows.length);
  const padX = 80;
  // Cabecera
  g.fillStyle = P.accent;
  g.font = `700 64px ${display}`;
  g.textBaseline = "alphabetic";
  g.fillText(o.name.slice(0, 26), padX, L.top + 64);
  g.fillStyle = P.fg2;
  g.font = `500 38px ${font}`;
  g.fillText(o.dateLine, padX, L.top + 118);
  g.fillStyle = P.fg;
  g.font = `700 44px ${display}`;
  g.fillText(`Objetivo ${o.target} · ${o.strategy}`, padX, L.top + 172);
  // Tabla
  const colW = (BAND_W - padX * 2 - (L.columns - 1) * 60) / L.columns;
  o.rows.forEach((r, i) => {
    const col = Math.floor(i / L.rowsPerColumn);
    const row = i % L.rowsPerColumn;
    const x = padX + col * (colW + 60);
    const y = L.tableTop + row * L.rowH;
    if (row % 2 === 0) {
      g.fillStyle = P.card;
      g.fillRect(x - 16, y, colW + 32, L.rowH);
    }
    const base = y + L.rowH * 0.68;
    g.fillStyle = P.fg2;
    g.font = `600 ${Math.round(L.fontPx * 0.8)}px ${font}`;
    g.textAlign = "left";
    g.fillText(r.lengthM < 1000 ? `${r.km}*` : String(r.km), x, base);
    g.fillStyle = P.fg;
    g.font = `700 ${L.fontPx}px ${display}`;
    g.textAlign = "right";
    const third = o.clock && L.columns === 1;
    g.fillText(pace(r.paceS), x + colW * (third ? 0.42 : 0.5), base);
    g.fillStyle = P.accent;
    g.fillText(fmtTime(r.cumS), x + colW * (third ? 0.76 : 1), base);
    if (third && r.clock) {
      g.fillStyle = P.fg2;
      g.font = `500 ${Math.round(L.fontPx * 0.7)}px ${font}`;
      g.fillText(r.clock.slice(0, 5), x + colW, base);
    }
    g.textAlign = "left";
  });
  g.fillStyle = P.fg2;
  g.font = `500 28px ${font}`;
  // Nota bajo la tabla (nunca encima de la última fila).
  const tableEnd = L.tableTop + L.rowH * L.rowsPerColumn;
  g.fillText("Guía, no garantía · * último tramo, no km entero", padX, Math.min(BAND_H - 40, tableEnd + 48));
}

/** Pantalla «Día de carrera»: tabla grande y botón para guardarla como imagen. */
export function RaceDay(props: { name: string; date: string; startTime: string | null; distanceM: number; targetS: number; strategy: Strategy; profile: RaceProfile | null }) {
  const rows = useMemo(
    () => pacePlan({ distanceM: props.distanceM, targetS: props.targetS, strategy: props.strategy, profile: props.profile, startTime: props.startTime }),
    [props.distanceM, props.targetS, props.strategy, props.profile, props.startTime],
  );
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [busy, setBusy] = useState(false);
  const dateLine = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${props.date}T00:00:00Z`)) + (props.startTime ? ` · salida ${props.startTime}` : "");
  const strategyLabel = STRATEGIES.find((s) => s.key === props.strategy)!.label;

  const save = async () => {
    setBusy(true);
    try {
      await document.fonts?.ready;
      const c = document.createElement("canvas");
      drawBand(c, { name: props.name, dateLine, target: fmtTime(props.targetS), strategy: strategyLabel, rows, theme, clock: !!props.startTime });
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("sin imagen"))), "image/png"));
      const file = new File([blob], `banda-${props.date}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Banda · ${props.name}` });
        toast.success("Imagen lista: elige «Guardar imagen» para llevarla a Fotos.");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast.success("Imagen descargada.");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast.error("No se pudo crear la imagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card card-hero p-5">
        <div className="eyebrow">Día de carrera</div>
        <div className="relative mt-1 font-display text-[26px] leading-tight font-bold">{props.name}</div>
        <div className="relative text-[14px] text-fg-2 first-letter:uppercase">{dateLine}</div>
        <div className="relative mt-2 text-[15px]">
          Objetivo <b className="num text-[22px]">{fmtTime(props.targetS)}</b> · {strategyLabel}
        </div>
      </section>

      <section className="card p-4" aria-label="Banda de ritmos">
        <table className="w-full">
          <thead>
            <tr className="text-[12px] tracking-[0.06em] text-fg-2 uppercase">
              <th scope="col" className="py-2 text-left font-semibold">Km</th>
              <th scope="col" className="py-2 text-right font-semibold">Ritmo</th>
              <th scope="col" className="py-2 text-right font-semibold">Paso</th>
              {props.startTime && <th scope="col" className="py-2 text-right font-semibold">Hora</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.km} className="odd:bg-ov-1">
                <td className="py-2 pl-1 text-[18px] text-fg-2">
                  {r.km}
                  {r.lengthM < 1000 && <span className="text-[13px]"> ({r.lengthM} m)</span>}
                </td>
                <td className="num py-2 text-right text-[30px]">{pace(r.paceS)}</td>
                <td className="num py-2 text-right text-[30px] text-lime-text">{fmtTime(r.cumS)}</td>
                {props.startTime && <td className="py-2 pr-1 text-right text-[16px] text-fg-2">{r.clock?.slice(0, 5)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-fg-2">Guía, no garantía: escucha a tu cuerpo el día de la carrera.</p>
      </section>

      <section className="card flex flex-col gap-3 p-5" aria-label="Guardar como imagen">
        <div className="eyebrow">Guardar como imagen</div>
        <p className="text-[13px] text-fg-2">Vertical, del tamaño de la pantalla del iPhone: deja libre la zona del reloj para usarla de fondo de pantalla.</p>
        <Segmented
          stretch
          label="Colores de la imagen"
          value={theme}
          onChange={(k) => setTheme(k as "dark" | "light")}
          items={[
            { key: "dark", label: "Oscura" },
            { key: "light", label: "Clara" },
          ]}
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          aria-busy={busy || undefined}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-lime text-[16px] font-semibold text-lime-ink"
        >
          {busy && <Spinner />}
          {busy ? "Creando la imagen…" : "Guardar como imagen"}
        </button>
      </section>
    </div>
  );
}

export { drawBand };
