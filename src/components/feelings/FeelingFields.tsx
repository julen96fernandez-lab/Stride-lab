"use client";

import { useState } from "react";
import { FEELING_TAGS, NOTE_MAX, RATING_COLOR, RATING_LABEL, TAG_KEYS, type Feeling, type FeelingTag } from "@/lib/feelings/feelings";

/**
 * Sensación dentro de un formulario (carrera manual): se envía con él en los campos feelRating,
 * feelTags (varios) y feelNote. Todo opcional.
 */
export function FeelingFields({ initial }: { initial?: Feeling | null }) {
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [tags, setTags] = useState<FeelingTag[]>(initial?.tags ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Sensaciones">
      <div>
        <div className="eyebrow">Sensaciones (opcional)</div>
        <p className="mt-1.5 text-[13px] text-fg-2">Cómo te sentiste. Lo puedes cambiar después en el detalle de la carrera.</p>
      </div>
      <input type="hidden" name="feelRating" value={rating ?? ""} />
      {tags.map((t) => (
        <input key={t} type="hidden" name="feelTags" value={t} />
      ))}
      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Cómo te sentiste (1 fatal, 5 genial)">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = rating === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n}: ${RATING_LABEL[n]}`}
              onClick={() => setRating(on ? null : n)}
              className="flex min-h-[56px] flex-col items-center justify-center rounded-2xl border"
              style={on ? { borderColor: RATING_COLOR[n], background: `color-mix(in srgb, ${RATING_COLOR[n]} 18%, transparent)` } : { borderColor: "var(--line-strong)" }}
            >
              <span className="num text-[20px]" style={on ? { color: RATING_COLOR[n] } : undefined}>
                {n}
              </span>
              <span className="text-[10px] text-fg-2">{RATING_LABEL[n]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Etiquetas">
        {TAG_KEYS.map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setTags((x) => (on ? x.filter((y) => y !== t) : TAG_KEYS.filter((k) => k === t || x.includes(k))))}
              className={`min-h-[44px] rounded-full border px-3.5 text-[13px] font-semibold ${on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg-2"}`}
            >
              {FEELING_TAGS[t]}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="sr-only">Nota</span>
        <textarea
          name="feelNote"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="Ej.: carrera popular, con viento… (opcional)"
          className="w-full resize-none rounded-2xl border border-line-strong bg-inset px-3.5 py-3 text-[15px] text-fg outline-none placeholder:text-fg-3 focus:border-lime"
        />
        <span className="mt-1 block text-right text-[11px] text-fg-3">
          {note.length}/{NOTE_MAX}
        </span>
      </label>
    </section>
  );
}
