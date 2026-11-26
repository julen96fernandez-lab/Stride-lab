"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveMineAction, moveSuggestionAction, removeMineAction, setDayDetailsAction, setDayKindAction } from "@/app/(app)/plan/session-actions";
import { Warnings } from "@/components/plan/SessionForm";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Spinner } from "@/components/ui/SubmitButton";
import { toast } from "@/components/ui/Toaster";
import { TYPE_META, isSessionType } from "@/lib/analysis/session-type";
import type { DayCell, DayPlan } from "@/lib/plan/calendar";
import { MINE_KINDS, MINE_LABEL, MINE_NOTE_MAX, MINE_PAST_DAYS, durationField, type MineKind } from "@/lib/plan/mine";
import { DAY_SHIFT_LABEL, SHIFT_META, dayNum, mondayOfDay, ymdOf, type ShiftKind } from "@/lib/plan/shifts";
import { setDayShiftAction } from "@/app/(app)/plan/calendar-actions";

const COLOR: Record<string, string> = {
  tirada_larga: "var(--t-tirada_larga)",
  calidad: "var(--t-series)",
  suave: "var(--t-rodaje)",
  otro: "var(--chart-line)",
  descanso: "var(--fg-3)",
};
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const btn = "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold";

/** Hoja del día: turno, sesiones previstas (editar, mover), carreras hechas y añadir. */
export function DaySheet({
  ymd,
  cell,
  shift,
  override,
  today,
  onClose,
}: {
  ymd: string | null;
  cell?: DayCell;
  shift?: ShiftKind;
  /** turno cambiado para este día (si lo hay) */
  override?: ShiftKind | null;
  today: string;
  onClose: () => void;
}) {
  if (!ymd) return null;
  const d = dayNum(ymd)!;
  const title = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
  const past = ymd < today;
  const canAddSession = d >= dayNum(today)! - MINE_PAST_DAYS;
  const all = cell?.plans ?? [];
  // Mi sesión del día (la primera mía) se maneja con los botones de arriba; el resto, en la lista.
  const primary = all.find((p) => p.mine) ?? null;
  const plans = all.filter((p) => p !== primary);
  const runs = cell?.runs ?? [];
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="first-letter:uppercase">{title}</span>
          {ymd === today && <span className="text-[13px] font-semibold text-lime-text">Hoy</span>}
        </span>
      }
    >
      <div className="flex flex-col gap-4" key={ymd}>
        {/* Turno: el de la semana y, si lo hay, el cambiado para este día */}
        {shift ? <DayShift key={ymd} ymd={ymd} week={shift} override={override ?? null} weekStartDay={Number(ymdOf(mondayOfDay(d)).slice(8))} /> : <span className="text-[14px] text-fg-2">Sin ciclo de turnos (se indica en Perfil).</span>}
        {cell?.race && (
          <div className="rounded-2xl px-3.5 py-2.5 text-[14px] font-semibold text-[var(--t-competicion)]" style={{ background: "color-mix(in srgb, var(--t-competicion) 14%, transparent)" }}>
            🏁 {cell.race}
          </div>
        )}
        {cell?.injury && <p className="text-[13px] text-danger">Día dentro de un periodo de lesión.</p>}

        {/* Entrenamiento del día con un toque */}
        {canAddSession ? (
          <QuickDay key={ymd} ymd={ymd} primary={primary} />
        ) : (
          <p className="text-[13px] text-fg-2">Solo se pueden poner sesiones desde hace {MINE_PAST_DAYS / 7} semanas.</p>
        )}

        {/* Previstas (la sugerencia y otras sesiones mías) */}
        <section aria-label="Sesiones previstas">
          <div className="eyebrow">{primary ? "También previstas" : "Previstas"}</div>
          {plans.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {plans.map((p, i) => (
                <PlanItem key={p.id ?? `s${i}`} p={p} day={ymd} onDone={onClose} />
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[14px] text-fg-2">{primary ? "Nada más." : "Nada previsto por la app."}</p>
          )}
        </section>

        {/* Hechas */}
        {(runs.length > 0 || past || ymd === today) && (
          <section aria-label="Carreras hechas">
            <div className="eyebrow">Hechas</div>
            {runs.length ? (
              <ul className="mt-2 flex flex-col gap-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/actividad/${r.id}`} className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-line bg-inset px-3.5 py-2 text-[14px]">
                      <span className="font-semibold text-[var(--load-low)]" aria-hidden="true">
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <b>{r.type && isSessionType(r.type) ? TYPE_META[r.type].label : "Carrera"}</b>
                        <span className="text-fg-2">
                          {r.km !== null ? ` · ${r.km.toLocaleString("es-ES")} km` : ""}
                          {r.paceS !== null ? ` · ${pace(r.paceS)} /km` : ""}
                        </span>
                      </span>
                      <span className="text-fg-3" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[14px] text-fg-2">Sin carreras ese día.</p>
            )}
          </section>
        )}

        {/* Añadir */}
        <div className="grid grid-cols-2 gap-2">
          {canAddSession ? (
            <Link href={`/plan/sesion/nueva?fecha=${ymd}`} className={`${btn} ${ymd > today ? "col-span-2" : ""} border border-line-strong`}>
              ＋ Añadir otra sesión
            </Link>
          ) : null}
          {ymd <= today && (
            <Link href={`/actividad/nueva?fecha=${ymd}`} className={`${btn} ${canAddSession ? "" : "col-span-2"} bg-lime text-lime-ink`}>
              ＋ Añadir carrera
            </Link>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

/** Una sesión prevista: mía o sugerida, con «Editar» y «Mover a…». */
function PlanItem({ p, day, onDone }: { p: DayPlan; day: string; onDone: () => void }) {
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState(day);
  const [pending, start] = useTransition();
  const edit = p.mine ? `/plan/sesion/${p.id}` : `/plan/sesion/nueva?semana=${p.week}`;
  const move = () =>
    start(async () => {
      try {
        const r = p.mine ? await moveMineAction(p.id!, to) : await moveSuggestionAction(p.week!, p.session!, to);
        if (r.ok) {
          if (r.message.includes("aviso")) toast.show("info", r.message);
          else toast.success(r.message);
          onDone();
        } else toast.error(r.message);
      } catch {
        toast.error("No se pudo mover. Inténtalo de nuevo.");
      }
    });
  return (
    <li className="rounded-2xl border border-line bg-inset px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: COLOR[p.kind], opacity: p.mine ? 1 : 0.4 }} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14px]">
          <b>{p.label}</b>
          {p.detail ? <span className="text-fg-2"> · {p.detail}</span> : null}
          {p.note && <span className="block truncate text-[12px] text-fg-2">{p.note}</span>}
        </span>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.mine ? "border border-lime/40 bg-lime/10 text-lime-text" : "border border-line-strong text-fg-2"}`}
        >
          {p.mine ? "Puesta por mí" : "Sugerida"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Link href={edit} className={`${btn} border border-line-strong`}>
          Editar
        </Link>
        <button type="button" aria-expanded={moving} onClick={() => setMoving((v) => !v)} className={`${btn} border border-line-strong`}>
          Mover a…
        </button>
      </div>
      {moving && (
        <div className="form-row mt-2 items-end">
          <label className="flex flex-col gap-1 text-[12px] text-fg-2">
            Nueva fecha
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-[var(--card)] px-3 text-[16px] text-fg outline-none focus:border-lime" />
          </label>
          <button type="button" disabled={pending || !to} onClick={move} className={`${btn} bg-lime text-lime-ink`}>
            {pending && <Spinner size={14} />}
            {pending ? "Moviendo…" : "Mover"}
          </button>
        </div>
      )}
      {!p.mine && <p className="mt-1.5 text-[11px] text-fg-3">Al editarla o moverla pasa a ser tuya y sustituye a la sugerencia de su semana.</p>}
    </li>
  );
}

const QUICK_LABEL: Record<MineKind, string> = { calidad: "Calidad", tirada_larga: "Tirada larga", suave: "Rodaje suave", otro: "Otro", descanso: "Descanso" };

/**
 * Botones grandes para poner el entrenamiento del día con un toque. Crea mi sesión al instante o,
 * si ya la hay, le cambia el tipo (el activo, resaltado). Debajo: km, duración y nota, y «Quitar».
 */
function QuickDay({ ymd, primary }: { ymd: string; primary: DayPlan | null }) {
  const server = primary ? { id: primary.id!, kind: primary.kind as MineKind } : null;
  // Lo elegido aquí se ve al instante; cuando llegan los datos del servidor, mandan ellos.
  const [opt, setOpt] = useState<{ id: string | null; kind: MineKind } | "removed" | null>(null);
  const [seen, setSeen] = useState(server ? `${server.id}:${server.kind}` : "");
  const now = server ? `${server.id}:${server.kind}` : "";
  if (now !== seen) {
    setSeen(now);
    setOpt(null);
  }
  const cur = opt === "removed" ? null : (opt ?? server);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const shown = warnings ?? primary?.warnings ?? [];
  const [busy, setBusy] = useState<MineKind | null>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);

  const choose = (k: MineKind) => {
    if (cur?.kind === k || pending) return;
    setOpt({ id: cur?.id ?? null, kind: k });
    setBusy(k);
    setConfirm(false);
    start(async () => {
      try {
        const r = await setDayKindAction(ymd, k, cur?.id ?? null);
        if (!r.ok) {
          setOpt(null);
          toast.error(r.message);
          return;
        }
        setOpt({ id: r.id ?? null, kind: k });
        setWarnings(r.warnings ?? []);
        if (r.warnings?.length) toast.show("info", r.message);
        else toast.success(r.message);
      } catch {
        setOpt(null);
        toast.error("No se pudo guardar. Inténtalo de nuevo.");
      } finally {
        setBusy(null);
      }
    });
  };

  const remove = () => {
    if (!cur?.id) return;
    if (!confirm) return setConfirm(true);
    const id = cur.id;
    setConfirm(false);
    setOpt("removed");
    start(async () => {
      try {
        const r = await removeMineAction(id);
        if (r.ok) {
          setWarnings([]);
          toast.success(r.message);
        } else {
          setOpt(null);
          toast.error(r.message);
        }
      } catch {
        setOpt(null);
        toast.error("No se pudo quitar. Inténtalo de nuevo.");
      }
    });
  };

  return (
    <section aria-label="Tu entrenamiento de este día">
      <div className="eyebrow">Tu entrenamiento</div>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de entrenamiento">
        {MINE_KINDS.map((k) => {
          const on = cur?.kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              aria-busy={busy === k || undefined}
              onClick={() => choose(k)}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border px-1 text-[13px] leading-tight font-semibold ${on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg"}`}
            >
              {busy === k ? (
                <Spinner size={14} />
              ) : (
                <span
                  className="h-2 w-2 rounded-full"
                  style={k === "descanso" ? { border: "1.5px solid currentColor" } : { background: on ? "currentColor" : COLOR[k] }}
                  aria-hidden="true"
                />
              )}
              {QUICK_LABEL[k]}
            </button>
          );
        })}
      </div>
      {shown.length > 0 && cur && (
        <div className="mt-2">
          <Warnings items={shown} />
        </div>
      )}
      {cur?.id && <Details key={cur.id} id={cur.id} kind={cur.kind} primary={primary} />}
      {cur?.id && (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className={`mt-2 min-h-[44px] w-full rounded-xl text-[14px] font-semibold ${confirm ? "border border-danger text-danger" : "text-fg-2"}`}
        >
          {confirm ? `Toca otra vez para quitar ${cur.kind === "descanso" ? "el descanso" : "la sesión"}` : "Quitar"}
        </button>
      )}
      {!cur && <p className="mt-1.5 text-[12px] text-fg-2">Un toque y queda puesta por ti; luego puedes añadir km, duración o una nota.</p>}
    </section>
  );
}

/** Km, duración y nota de mi sesión del día (opcionales). */
function Details({ id, kind, primary }: { id: string; kind: MineKind; primary: DayPlan | null }) {
  const same = primary?.id === id;
  const [km, setKm] = useState(same && primary?.distanceM ? String(primary.distanceM / 1000).replace(".", ",") : "");
  const [dur, setDur] = useState(same ? durationField(primary?.durationS ?? null) : "");
  const [note, setNote] = useState(same ? (primary?.note ?? "") : "");
  const [pending, start] = useTransition();
  const field = "h-11 w-full rounded-xl border border-line-strong bg-[var(--card)] px-3 text-[16px] text-fg outline-none focus:border-lime";
  const save = () =>
    start(async () => {
      try {
        const r = await setDayDetailsAction(id, { distanceKm: kind === "descanso" ? "" : km, duration: kind === "descanso" ? "" : dur, note });
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      } catch {
        toast.error("No se pudo guardar. Inténtalo de nuevo.");
      }
    });
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-line bg-inset p-3">
      <div className="text-[12px] text-fg-2">
        {MINE_LABEL[kind]} · puesta por ti · opcional:
      </div>
      {kind !== "descanso" && (
        <div className="form-row">
          <label className="flex flex-col gap-1 text-[12px] text-fg-2">
            Distancia (km)
            <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="Ej.: 10" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-fg-2">
            Duración
            <input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value)} placeholder="45 o 1:15" className={field} />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1 text-[12px] text-fg-2">
        Nota
        <input value={note} maxLength={MINE_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={kind === "descanso" ? "Ej.: piernas cargadas" : "Ej.: 6 × 1000"} className={field} />
      </label>
      <button type="button" disabled={pending} onClick={save} className={`${btn} border border-line-strong`}>
        {pending && <Spinner size={14} />}
        {pending ? "Guardando…" : "Guardar detalles"}
      </button>
    </div>
  );
}

const SHIFT_ORDER: ShiftKind[] = ["mananas", "tardes", "noches", "libre"];

/**
 * Turno del día: el de la semana o el cambiado solo para este día. «Cambiar el turno de este día»
 * lo sobreescribe (Mañana, Tarde, Noche o Libre) y el plan se recalcula con él; «Quitar el
 * cambio» vuelve al del ciclo.
 */
function DayShift({ ymd, week, override, weekStartDay }: { ymd: string; week: ShiftKind; override: ShiftKind | null; weekStartDay: number }) {
  const [opt, setOpt] = useState<ShiftKind | "none" | null>(null);
  const [seen, setSeen] = useState(override ?? "");
  if ((override ?? "") !== seen) {
    setSeen(override ?? "");
    setOpt(null);
  }
  const cur = opt === "none" ? null : (opt ?? override);
  const eff = cur ?? week;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: ShiftKind | null) => {
    if (pending) return;
    if (k !== null && k === cur) return;
    // Elegir el turno de la semana es quitar el cambio.
    if (k === week) k = null;
    if (k === null && !cur) return;
    setOpt(k ?? "none");
    setBusy(k ?? "none");
    start(async () => {
      try {
        const r = await setDayShiftAction(ymd, k);
        if (r.ok) toast.success(r.message);
        else {
          setOpt(null);
          toast.error(r.message);
        }
      } catch {
        setOpt(null);
        toast.error("No se pudo cambiar el turno. Inténtalo de nuevo.");
      } finally {
        setBusy(null);
      }
    });
  };
  return (
    <section aria-label="Turno del día" className="flex flex-col gap-2">
      <div className="flex items-start gap-2 text-[14px]">
        <span className="mt-[5px] h-2.5 w-2.5 flex-none rounded-full" style={{ background: SHIFT_META[eff].color }} aria-hidden="true" />
        {cur ? (
          <span>
            Turno de este día: <b>{DAY_SHIFT_LABEL[cur].toLowerCase()}</b>
            <span className="text-fg-2">
              {" "}
              · cambiado (la semana es de {SHIFT_META[week].label.toLowerCase()})
            </span>
          </span>
        ) : (
          <span>
            Semana de <b>{SHIFT_META[week].label.toLowerCase()}</b>
            <span className="text-fg-2"> · desde el lunes {weekStartDay}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="-ml-1 inline-flex min-h-[44px] items-center self-start px-1 text-[13px] font-semibold text-fg underline-offset-2 hover:underline"
      >
        Cambiar el turno de este día {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Turno de este día">
            {SHIFT_ORDER.map((k) => {
              const on = eff === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-busy={busy === k || undefined}
                  onClick={() => set(k)}
                  className={`flex min-h-[48px] items-center justify-center gap-1 rounded-xl border px-1 text-[13px] font-semibold ${on ? "text-[var(--bg)]" : "border-line-strong text-fg"}`}
                  style={on ? { background: SHIFT_META[k].color, borderColor: SHIFT_META[k].color } : undefined}
                >
                  {busy === k ? <Spinner size={12} /> : DAY_SHIFT_LABEL[k]}
                </button>
              );
            })}
          </div>
          {cur && (
            <button type="button" onClick={() => set(null)} disabled={pending} className={`${btn} border border-line-strong text-fg-2`}>
              {busy === "none" && <Spinner size={12} />}
              Quitar el cambio (volver a {SHIFT_META[week].label.toLowerCase()})
            </button>
          )}
          <p className="text-[11px] leading-snug text-fg-3">
            Solo este día. Las sugerencias, los avisos y «Hoy» usan este turno: un día de noche, solo suave u opcional; el siguiente, nada exigente.
          </p>
        </div>
      )}
    </section>
  );
}
