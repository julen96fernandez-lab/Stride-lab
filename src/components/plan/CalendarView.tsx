"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { calendarBlockAction } from "@/app/(app)/plan/calendar-actions";
import { toast } from "@/components/ui/Toaster";
import { CAL_KINDS, CAL_LABEL, addMonths, covers, mergeBlocks, monthGrid, type CalKind, type CalendarBlock, type DayCell } from "@/lib/plan/calendar";
import { SHIFT_META, dayNum, mondayOfDay, ymdOf, type ShiftKind } from "@/lib/plan/shifts";
import { DaySheet } from "./DaySheet";

export const CAL_COLOR: Record<CalKind, string> = {
  tirada_larga: "var(--t-tirada_larga)",
  calidad: "var(--t-series)",
  suave: "var(--t-rodaje)",
  otro: "var(--chart-line)",
  descanso: "var(--fg-3)",
};
const SHIFT_LETTER: Record<ShiftKind, string> = { tardes: "T", noches: "N", libre: "L", mananas: "M" };
const WD = ["L", "M", "X", "J", "V", "S", "D"];
const monthName = (y: number, m: number) => {
  const s = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${y}`;
};
const kmText = (km: number | null) => (km === null ? "" : km.toLocaleString("es-ES", { maximumFractionDigits: km >= 10 ? 0 : 1 }));

/**
 * Calendario mensual de Plan. Llega un bloque de ±3 meses ya calculado: cambiar de mes dentro
 * de él es instantáneo (se filtra aquí). Más allá, se pide el bloque siguiente y, mientras
 * llega, se ve un esqueleto con la forma de la cuadrícula.
 */
export function CalendarView({ initial, today }: { initial: CalendarBlock; today: string }) {
  const t = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const [ym, setYm] = useState(t);
  const [block, setBlock] = useState(initial);
  // Tras guardar algo, la página trae un bloque nuevo: se cambia por el de aquí.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setBlock(initial);
  }
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const loading = useRef(new Set<string>());

  const go = (next: { year: number; month: number }) => {
    setYm(next);
    if (covers(block, next.year, next.month)) return;
    const key = `${next.year}-${next.month}`;
    if (loading.current.has(key)) return;
    loading.current.add(key);
    start(async () => {
      try {
        const b = await calendarBlockAction(next.year, next.month);
        if (b) setBlock((cur) => mergeBlocks(cur, b));
        else toast.error("No se pudo cargar ese mes.");
      } catch {
        toast.error("No se pudo cargar ese mes. Comprueba la conexión.");
      } finally {
        loading.current.delete(key);
      }
    });
  };

  const grid = useMemo(() => monthGrid(ym.year, ym.month), [ym]);
  const ready = covers(block, ym.year, ym.month);
  const isToday = ym.year === t.year && ym.month === t.month;

  // Deslizar a izquierda o derecha para cambiar de mes.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(addMonths(ym, dx < 0 ? 1 : -1));
  };

  return (
    <section className="card p-4" aria-label="Calendario">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(addMonths(ym, -1))} aria-label="Mes anterior" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-2 hover:bg-ov-2">
          <Chevron dir="left" />
        </button>
        <h2 className="min-w-0 flex-1 text-center text-[17px] font-semibold" aria-live="polite">
          {monthName(ym.year, ym.month)}
        </h2>
        <button type="button" onClick={() => go(addMonths(ym, 1))} aria-label="Mes siguiente" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-2 hover:bg-ov-2">
          <Chevron dir="right" />
        </button>
      </div>
      <div className="mt-1 flex justify-center">
        <button
          type="button"
          onClick={() => go(t)}
          disabled={isToday}
          className={`min-h-[44px] rounded-full px-4 text-[13px] font-semibold ${isToday ? "text-fg-3" : "text-fg underline-offset-2 hover:underline"}`}
        >
          Hoy
        </button>
      </div>

      <div className="mt-1 select-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grid grid-cols-[14px_repeat(7,minmax(0,1fr))] gap-x-1 pb-1 text-center text-[11px] font-semibold text-fg-2" aria-hidden="true">
          <span />
          {WD.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div role="grid" aria-label={`Calendario de ${monthName(ym.year, ym.month)}`} aria-busy={pending || undefined} className="flex flex-col gap-1">
          {grid.map((w) => {
            const shift = block.shifts[w.start] as ShiftKind | undefined;
            return (
              <div key={w.start} role="row" className="grid grid-cols-[14px_repeat(7,minmax(0,1fr))] gap-x-1" aria-label={shift ? `Semana de ${SHIFT_META[shift].label.toLowerCase()}` : undefined}>
                <span
                  className="flex items-center justify-center rounded-full text-[9px] font-bold text-[var(--bg)]"
                  style={{ background: ready && shift ? SHIFT_META[shift].color : "var(--ov-2)" }}
                  title={shift ? SHIFT_META[shift].label : undefined}
                  aria-hidden="true"
                >
                  {ready && shift ? SHIFT_LETTER[shift] : ""}
                </span>
                {w.days.map((d) =>
                  ready ? (
                    <Day key={d.ymd} ymd={d.ymd} d={d.d} inMonth={d.inMonth} today={d.ymd === today} cell={block.days[d.ymd]} onOpen={setOpen} />
                  ) : (
                    <div key={d.ymd} role="gridcell" className="skel h-[54px] rounded-xl" aria-hidden="true" />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Legend />
      <DaySheet
        ymd={open}
        cell={open ? block.days[open] : undefined}
        shift={open ? (block.shifts[ymdOf(mondayOfDay(dayNum(open)!))] as ShiftKind | undefined) : undefined}
        today={today}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}

function Day({ ymd, d, inMonth, today, cell, onOpen }: { ymd: string; d: number; inMonth: boolean; today: boolean; cell?: DayCell; onOpen: (ymd: string) => void }) {
  const label = [
    new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`)),
    today ? "hoy" : null,
    ...(cell?.plans.map(
      (p) => `${CAL_LABEL[p.kind]}${p.mine ? " (puesta por mí)" : " (sugerida)"}${p.covered && p.covered.offset !== 0 ? `, ya cumplida otro día: ${p.covered.when?.toLowerCase() ?? ""}` : ""}`,
    ) ?? []),
    ...(cell?.runs.map((r) => `corrida${r.km !== null ? ` ${kmText(r.km)} km` : ""}`) ?? []),
    cell?.race ? `carrera objetivo: ${cell.race}` : null,
    cell?.injury ? "lesión" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      onClick={() => onOpen(ymd)}
      className={`relative flex h-[54px] min-w-0 flex-col items-center overflow-hidden rounded-xl pt-1 ${inMonth ? "bg-inset" : "opacity-40"} ${today ? "ring-2 ring-lime" : ""}`}
    >
      <span className={`text-[12px] leading-none ${today ? "font-bold text-lime-text" : "text-fg"}`}>{d}</span>
      {cell?.race && (
        <span className="absolute top-0.5 right-0.5 text-[9px] leading-none" aria-hidden="true">
          🏁
        </span>
      )}
      {!!cell?.plans.length && (
        <span className="mt-1 flex gap-[3px]" aria-hidden="true">
          {cell.plans.slice(0, 3).map((p, i) => (
            <span
              key={i}
              className="h-[7px] w-[7px] rounded-full"
              style={
                p.kind === "descanso"
                  ? { border: "1.5px solid var(--fg-2)" }
                  : p.covered && p.covered.offset !== 0
                    ? // ya cumplida otro día de su semana: hueca y gris (no queda pendiente)
                      { border: "1.5px solid var(--fg-3)" }
                    : { background: CAL_COLOR[p.kind], opacity: p.mine ? 1 : 0.35 }
              }
            />
          ))}
        </span>
      )}
      {!!cell?.runs.length && (
        <span className="mt-0.5 truncate text-[10px] leading-tight font-semibold text-[var(--load-low)]" aria-hidden="true">
          ✓{kmText(cell.runs.reduce((a, r) => a + (r.km ?? 0), 0) || null)}
        </span>
      )}
      {cell?.injury && <span className="absolute inset-x-1 bottom-0.5 h-[3px] rounded-full bg-danger opacity-70" aria-hidden="true" />}
    </button>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-col gap-1.5 text-[11px] text-fg-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {(Object.keys(SHIFT_META) as ShiftKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-[var(--bg)]" style={{ background: SHIFT_META[k].color }}>
              {SHIFT_LETTER[k]}
            </span>
            {SHIFT_META[k].label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {CAL_KINDS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="h-[7px] w-[7px] rounded-full" style={k === "descanso" ? { border: "1.5px solid var(--fg-2)" } : { background: CAL_COLOR[k] }} />
            {CAL_LABEL[k]}
          </span>
        ))}
      </div>
      <p>
        Punto tenue: sugerencia de la app; fuerte: puesta por ti;{" "}
        <span className="inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ border: "1.5px solid var(--fg-3)" }} /> hueco gris: ya cumplida
        otro día de su semana. <span className="font-semibold text-[var(--load-low)]">✓</span> corrida (km) · 🏁 carrera objetivo ·{" "}
        <span className="inline-block h-[3px] w-3 rounded-full bg-danger align-middle opacity-70" /> lesión
      </p>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d={dir === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
