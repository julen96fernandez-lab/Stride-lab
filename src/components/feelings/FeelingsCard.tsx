"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { deleteFeelingAction, saveFeelingAction } from "@/app/(app)/actividad/feeling-actions";
import { FEELING_TAGS, NOTE_MAX, RATING_LABEL, TAG_KEYS, type Feeling, type FeelingTag } from "@/lib/feelings/feelings";

/** Color de cada valoración (de rojo a lima), el mismo en Actividad y Análisis. */
export const RATING_COLOR: Record<number, string> = {
  1: "var(--load-high)",
  2: "var(--load-mod)",
  3: "var(--fg-2)",
  4: "var(--t-rodaje)",
  5: "var(--chart-line)",
};

/**
 * Sensaciones de la carrera. Valoración y etiquetas se guardan al tocarlas; la nota, al salir
 * del campo o tras una pausa al escribir. Cada guardado avisa con un toast.
 */
export function FeelingsCard({ runId, initial }: { runId: string; initial: Feeling | null }) {
  const [f, setF] = useState<Feeling>(initial ?? { rating: null, note: null, tags: [] });
  const [note, setNote] = useState(initial?.note ?? "");
  const [saved, setSaved] = useState(!!initial);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(JSON.stringify(initial ?? { rating: null, note: null, tags: [] }));

  const persist = (next: Feeling) => {
    const key = JSON.stringify(next);
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    start(async () => {
      try {
        const r = await saveFeelingAction(runId, next);
        if (r.ok) {
          toast.success(r.message);
          setSaved(!(next.rating === null && !next.note && next.tags.length === 0));
        } else toast.error(r.message);
      } catch {
        toast.error("No se pudo guardar la sensación. Inténtalo de nuevo.");
        lastSaved.current = "";
      }
    });
  };

  const update = (patch: Partial<Feeling>) => {
    const next = { ...f, ...patch };
    setF(next);
    persist(next);
  };

  // Nota: se guarda tras 1,2 s sin escribir (y al salir del campo).
  const onNote = (v: string) => {
    setNote(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitNote(v), 1200);
  };
  const commitNote = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    const next = { ...f, note: v.trim() || null };
    setF(next);
    persist(next);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const toggleTag = (t: FeelingTag) => update({ tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : TAG_KEYS.filter((k) => k === t || f.tags.includes(k)) });

  const remove = () => {
    if (!confirm) return setConfirm(true);
    setConfirm(false);
    start(async () => {
      try {
        const r = await deleteFeelingAction(runId);
        if (r.ok) {
          toast.success(r.message);
          const empty = { rating: null, note: null, tags: [] };
          lastSaved.current = JSON.stringify(empty);
          setF(empty);
          setNote("");
          setSaved(false);
        } else toast.error(r.message);
      } catch {
        toast.error("No se pudo borrar la sensación.");
      }
    });
  };

  return (
    <section className="card p-4" aria-label="Sensaciones" aria-busy={pending || undefined}>
      <div className="flex items-baseline justify-between px-1">
        <div className="eyebrow">Sensaciones</div>
        <span className="flex min-h-[20px] items-center gap-1.5 text-[11px] text-fg-2">
          {pending ? (
            <>
              <Spinner size={12} /> Guardando…
            </>
          ) : saved ? (
            "Guardado"
          ) : (
            "Opcional"
          )}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Cómo te sentiste (1 fatal, 5 genial)">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = f.rating === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n}: ${RATING_LABEL[n]}`}
              onClick={() => update({ rating: on ? null : n })}
              className="flex min-h-[56px] flex-col items-center justify-center rounded-2xl border text-center"
              style={
                on
                  ? { borderColor: RATING_COLOR[n], background: `color-mix(in srgb, ${RATING_COLOR[n]} 18%, transparent)` }
                  : { borderColor: "var(--line-strong)" }
              }
            >
              <span className="num text-[20px]" style={on ? { color: RATING_COLOR[n] } : undefined}>
                {n}
              </span>
              <span className="text-[10px] text-fg-2">{RATING_LABEL[n]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Etiquetas">
        {TAG_KEYS.map((t) => {
          const on = f.tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => toggleTag(t)}
              className={`min-h-[44px] rounded-full border px-3.5 text-[13px] font-semibold ${on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg-2"}`}
            >
              {FEELING_TAGS[t]}
            </button>
          );
        })}
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Nota</span>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value.slice(0, NOTE_MAX))}
          onBlur={(e) => commitNote(e.target.value)}
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="Cómo fue, qué notaste… (opcional)"
          className="w-full resize-none rounded-2xl border border-line-strong bg-inset px-3.5 py-3 text-[15px] text-fg outline-none placeholder:text-fg-3 focus:border-lime"
        />
        <span className="mt-1 block text-right text-[11px] text-fg-3">
          {note.length}/{NOTE_MAX}
        </span>
      </label>

      {saved && (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className={`mt-1 min-h-[44px] w-full rounded-xl text-[14px] font-semibold ${confirm ? "border border-danger text-danger" : "text-fg-2"}`}
        >
          {confirm ? "Toca otra vez para borrar la sensación" : "Borrar sensación"}
        </button>
      )}
    </section>
  );
}
