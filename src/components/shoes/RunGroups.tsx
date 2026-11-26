"use client";

import type { ReactNode } from "react";
import { useChoice } from "@/components/ui/Choice";
import { km } from "@/lib/format";

export interface GroupRow {
  id: string;
  shoeId: string | null;
  /** «Noviembre de 2026» */
  month: string;
  distanceM: number | null;
  /** fila ya pintada en el servidor */
  node: ReactNode;
}

/**
 * Lista de carreras por meses con el filtro de zapatilla aplicado en el móvil: cada lista llega
 * una vez y elegir zapatilla solo esconde filas (sin ir al servidor ni repetir la lista).
 */
export function RunGroups({
  rows,
  typeLabel,
  label,
  hiddenText,
  emptyText,
  shoes,
}: {
  rows: GroupRow[];
  /** «de rodaje» */
  typeLabel: string | null;
  /** «con sensación» */
  label: string | null;
  hiddenText: string | null;
  emptyText: string;
  shoes: { id: string; name: string }[];
}) {
  const [chosen = "todas"] = useChoice("zapatilla");
  const shoe = shoes.length ? chosen : "todas";
  const items = shoe === "todas" ? rows : shoe === "sin" ? rows.filter((r) => !r.shoeId) : rows.filter((r) => r.shoeId === shoe);
  const shoeText = shoe === "todas" ? null : shoe === "sin" ? "sin zapatilla" : `con ${shoes.find((x) => x.id === shoe)?.name ?? "esa zapatilla"}`;
  const groups: { key: string; rows: GroupRow[] }[] = [];
  for (const r of items) {
    const g = groups.at(-1);
    if (g && g.key === r.month) g.rows.push(r);
    else groups.push({ key: r.month, rows: [r] });
  }
  const sumKm = (list: GroupRow[]) => list.reduce((a, r) => a + (r.distanceM ?? 0), 0);
  const head = [`${items.length} ${items.length === 1 ? "carrera" : "carreras"}`, typeLabel, label, shoeText].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-2">
        {head}
        {(typeLabel || shoeText) && ` · ${km(sumKm(items), 0)} km`}
        {hiddenText && shoe === "todas" && ` · ${hiddenText}`}
      </p>

      {items.length === 0 && (
        <div className="card p-5">
          <p className="text-[14px] text-fg-2">{shoeText ? "Ninguna carrera con este filtro." : emptyText}</p>
        </div>
      )}

      <div className="stagger flex flex-col gap-4">
        {groups.map((g, gi) => (
          <section key={g.key} className={`card px-4 py-3 ${gi > 1 ? "cv-auto" : ""}`}>
            <div className="flex items-baseline justify-between px-1 pt-1 pb-1">
              <h2 className="font-display text-[17px] font-bold tracking-[-0.01em]">{g.key}</h2>
              <span className="text-[12px] text-fg-2">
                {g.rows.length} · {km(sumKm(g.rows), 1)} km
              </span>
            </div>
            <ul className="divide-y divide-line">
              {g.rows.map((r) => (
                <li key={r.id}>{r.node}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
