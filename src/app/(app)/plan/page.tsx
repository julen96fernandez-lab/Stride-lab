import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ProfileSkeleton } from "@/components/ui/Skeletons";
import { calendarScreen, planScreen } from "@/lib/db/screens";
import { ChoicePanel, ChoiceProvider, ChoiceSelector } from "@/components/ui/Choice";
import { CalendarView } from "@/components/plan/CalendarView";
import { blockRange } from "@/lib/plan/calendar";
import { choicesFromParams } from "@/lib/ui/choice";
import { cacheDay } from "@/lib/cache/tags";
import { SHIFT_META, dayNum, ymdOf } from "@/lib/plan/shifts";
import { PredictionsCard } from "@/components/charts/PredictionsCard";
import { RacesBlock } from "@/components/race/RaceCards";
import { fmtDay, type SessionKind, type WeekSession } from "@/lib/plan/weekly";
import { STATUS_LABEL, type WeekStatus } from "@/lib/plan/compliance";
import { RescheduleButton } from "./RescheduleButton";
import { RestoreSuggestion } from "./RestoreSuggestion";
import { Warnings } from "@/components/plan/SessionForm";
import type { Hidden, MineView, RunBrief } from "@/lib/db/queries";
import { MINE_STATUS_LABEL, type MineStatus } from "@/lib/plan/linking";
import type { MineKind } from "@/lib/plan/mine";

export const metadata = { title: "Plan · Stride Lab" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = { vista: { default: "resumen", options: ["resumen", "calendario"] } } as const;
const DEFAULTS = { vista: "resumen" };

export default function PlanPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mt-4">
        <PageHeader
          title="Plan"
          subtitle="Turnos, marcas estimadas y tu semana."
        />
      </div>
      <Suspense
        fallback={
          <>
            <span className="skel block h-11 rounded-full" aria-hidden="true" />
            <ProfileSkeleton rows={6} />
          </>
        }
      >
        <PlanData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", ...o }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
/** «23–29 nov» o «28 dic – 3 ene» */
function range(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth
    ? `${fmt(start, { day: "numeric" })}–${fmt(end, { day: "numeric", month: "short" })}`
    : `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short" })}`;
}

async function PlanData({ searchParams }: { searchParams: SP }) {
  await connection();
  const day = cacheDay();
  const { from, to } = blockRange({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) });
  const [sp, plan, calendar] = await Promise.all([searchParams, planScreen(day), calendarScreen(day, from, to)]);
  const initial = choicesFromParams(sp, VIEWS);
  return (
    <ChoiceProvider initial={initial} defaults={DEFAULTS}>
      <ChoiceSelector
        name="vista"
        label="Vista de Plan"
        stretch
        items={[
          { key: "resumen", label: "Resumen" },
          { key: "calendario", label: "Calendario" },
        ]}
      />
      <ChoicePanel when={{ vista: "resumen" }}>
        <div className="flex flex-col gap-4">
          <PlanSummary plan={plan} />
        </div>
      </ChoicePanel>
      <ChoicePanel when={{ vista: "calendario" }}>
        <CalendarView initial={calendar} today={day} />
      </ChoicePanel>
    </ChoiceProvider>
  );
}

function PlanSummary({ plan }: { plan: Awaited<ReturnType<typeof planScreen>> }) {
  const {
    anchor,
    today,
    weeks,
    sessions,
    current: cur,
    past,
    predictions,
    races,
    mine,
    hidden,
    unplanned,
  } = plan;
  const preds = (
    <PredictionsCard
      now={predictions.now}
      history={predictions.history}
      longestM={predictions.longestM}
    />
  );
  if (!anchor) {
    return (
      <>
        <RacesBlock races={races} />
        <Card>
          <div className="eyebrow">Sin ciclo de turnos</div>
          <p className="mt-3 text-[14px] text-fg-2">
            Indica en Perfil el lunes en que empieza un bloque de tardes y aquí
            verás tus próximas semanas.
          </p>
          <Link
            href="/perfil#turnos"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-lime px-4 text-[14px] font-semibold text-lime-ink"
          >
            Ir a Perfil
          </Link>
        </Card>
        {preds}
      </>
    );
  }
  const current = weeks[0];
  const sessionsBy = new Map(sessions.map((x) => [x.start, x]));
  const todayDay = dayNum(today)!;
  const left = current.startDay + 6 - todayDay;
  const mineBy = new Map<string, MineView[]>();
  for (const m of mine) mineBy.set(m.week, [...(mineBy.get(m.week) ?? []), m]);
  const lastWeek = weeks[weeks.length - 1].start;
  const later = mine.filter((m) => m.week > lastWeek);
  return (
    <>
      <RacesBlock races={races} />

      <section className="card card-hero p-5" aria-label="Esta semana">
        <div className="flex items-center justify-between">
          <div className="eyebrow">
            Esta semana · {range(current.start, current.end)}
          </div>
          <ShiftPill kind={current.kind} />
        </div>
        <p className="relative mt-3 text-[15px] leading-relaxed">
          {SHIFT_META[current.kind].hint}
        </p>
        <p className="relative mt-1 text-[12px] text-fg-2">
          {left === 0
            ? "Último día del bloque."
            : `Quedan ${left} ${left === 1 ? "día" : "días"} de este bloque.`}{" "}
          Semana {current.pos + 1} de 5 del ciclo.
        </p>
        {cur && <SessionBlock s={cur} />}
        {(mineBy.get(current.start) ?? []).length > 0 && (
          <div className="relative mt-3">
            <div className="text-[12px] text-fg-2">
              Tus sesiones esta semana
            </div>
            <MineList items={mineBy.get(current.start)!} today={today} />
          </div>
        )}
        {(unplanned[current.start] ?? []).length > 0 && (
          <div className="relative mt-3">
            <UnplannedList items={unplanned[current.start]} />
          </div>
        )}
        <Link
          href="/plan/sesion/nueva"
          className="relative mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-line-strong text-[15px] font-semibold"
        >
          <span aria-hidden="true">＋</span> Añadir sesión
        </Link>
      </section>

      <section className="card p-5" aria-label="Próximas semanas">
        <div className="flex items-baseline justify-between">
          <div className="eyebrow">Próximas semanas</div>
          <Link
            href="/perfil#turnos"
            className="-my-3 -mr-2 inline-flex min-h-[44px] items-center px-2 text-[12px] text-fg-2"
          >
            Cambiar ciclo
          </Link>
        </div>
        <ol className="mt-2 divide-y divide-line">
          {weeks.slice(1).map((w) => (
            <li key={w.start} className="min-h-[52px] py-2">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">
                      {range(w.start, w.end)}
                    </div>
                    <div className="text-[12px] text-fg-2">
                      {fmt(w.start, { year: "numeric" }) !==
                      fmt(today, { year: "numeric" })
                        ? `${fmt(w.start, { year: "numeric" })} · `
                        : ""}
                      semana {w.pos + 1} de 5
                    </div>
                  </div>
                  <ShiftPill kind={w.kind} />
                </div>
                {sessionsBy.get(w.start)?.race && (
                  <RaceMark race={sessionsBy.get(w.start)!.race!} />
                )}
                {sessionsBy.get(w.start) && (
                  <Suggestion
                    s={sessionsBy.get(w.start)!}
                    hidden={hidden[w.start] ?? null}
                  />
                )}
                {(mineBy.get(w.start) ?? []).length > 0 && (
                  <MineList items={mineBy.get(w.start)!} today={today} />
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] text-fg-2">
          Calculado desde el lunes{" "}
          {fmt(anchor, { day: "numeric", month: "long", year: "numeric" })}{" "}
          (inicio de un bloque de tardes). Hoy:{" "}
          {fmt(ymdOf(todayDay), {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          .
        </p>
      </section>

      {past.some((w) => w.sug || mineBy.has(w.start) || unplanned[w.start]) && (
        <section className="card p-5" aria-label="Semanas anteriores">
          <div className="eyebrow">
            Semanas anteriores · previsto frente a realizado
          </div>
          <ol className="mt-2 divide-y divide-line">
            {past
              .filter((w) => w.sug || mineBy.has(w.start) || unplanned[w.start])
              .map((w) => (
                <li
                  key={w.start}
                  className="flex min-h-[52px] items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">
                      {range(w.start, w.end)}
                    </div>
                    <div className="text-[12px] text-fg-2">
                      {w.sug ? (
                        <>
                          <SessionDot kind={w.sug.session} />{" "}
                          <span className={w.hidden ? "line-through" : ""}>
                            {w.sug.label} · {w.sug.dayLabel}
                          </span>
                        </>
                      ) : (
                        "Sin sugerencia guardada"
                      )}
                    </div>
                    {(mineBy.get(w.start) ?? []).length > 0 && (
                      <MineList items={mineBy.get(w.start)!} today={today} />
                    )}
                    {(unplanned[w.start] ?? []).length > 0 && (
                      <UnplannedList items={unplanned[w.start]} />
                    )}
                  </div>
                  {w.hidden ? (
                    <HiddenPill hidden={w.hidden} />
                  ) : w.sug ? (
                    <StatusPill status={w.sug.status} />
                  ) : null}
                </li>
              ))}
          </ol>
          <p className="mt-2 text-[12px] text-fg-2">
            Sugerencia cumplida: una carrera del tipo previsto en esa semana
            (tirada larga; calidad = series, tempo o competición; suave =
            cualquier carrera). Tus sesiones se vinculan con la carrera del
            mismo día o de ±1 día.
          </p>
        </section>
      )}

      {later.length > 0 && (
        <section className="card p-5" aria-label="Más adelante">
          <div className="eyebrow">Tus sesiones más adelante</div>
          <MineList items={later} today={today} />
        </section>
      )}

      {preds}
    </>
  );
}

const MINE_COLOR: Record<MineKind, string> = {
  tirada_larga: "var(--t-tirada_larga)",
  calidad: "var(--t-series)",
  suave: "var(--t-rodaje)",
  otro: "var(--chart-line)",
};

/** Mis sesiones: cada una abre su edición. */
function MineList({ items, today }: { items: MineView[]; today: string }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5">
      {items.map((m) => (
        <li key={m.id}>
          <Link
            href={`/plan/sesion/${m.id}`}
            className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-line bg-inset px-3 py-2"
          >
            <span
              className="h-2 w-2 flex-none rounded-full"
              style={{ background: MINE_COLOR[m.kind] }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 text-[14px]">
              <b>{m.label}</b>
              <span className="text-fg-2">
                {" "}
                · {m.date === today ? "hoy" : m.dayLabel}
                {m.detail ? ` · ${m.detail}` : ""}
              </span>
              {m.note && (
                <span className="block truncate text-[12px] text-fg-2">
                  {m.note}
                </span>
              )}
            </span>
            <MinePill />
          </Link>
          {m.done ? (
            <Compare m={m} run={m.done} />
          ) : m.status === "no_hecha" ? (
            <div className="mt-1 flex justify-end">
              <MineStatusPill status="no_hecha" />
            </div>
          ) : (
            m.warnings.length > 0 && <Warnings items={m.warnings} compact />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Prevista frente a realizada: tipo, km y ritmo. Abre la carrera. */
function Compare({ m, run }: { m: MineView; run: RunBrief }) {
  const km = (s: string | null) => (s ? `${s} km` : "—");
  return (
    <Link
      href={`/actividad/${run.id}`}
      aria-label={`Ver la carrera del ${run.dayLabel}`}
      className="mt-1 block rounded-2xl border border-line px-3 py-2 text-[13px]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-fg-2">
          Hecha el {run.date === m.date ? "mismo día" : run.dayLabel} ›
        </span>
        <MineStatusPill status={m.status} />
      </div>
      <table className="mt-1 w-full">
        <thead>
          <tr className="text-[11px] tracking-[0.06em] text-fg-2 uppercase">
            <th scope="col" className="py-0.5 text-left font-semibold">
              <span className="sr-only">Sesión</span>
            </th>
            <th scope="col" className="py-0.5 text-left font-semibold">
              Tipo
            </th>
            <th scope="col" className="py-0.5 text-right font-semibold">
              Km
            </th>
            <th scope="col" className="py-0.5 text-right font-semibold">
              Ritmo
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="py-0.5 text-left font-normal text-fg-2">
              Prevista
            </th>
            <td className="py-0.5">{m.label}</td>
            <td className="py-0.5 text-right">{km(m.plannedKm)}</td>
            <td className="py-0.5 text-right">
              {m.plannedPace ? `${m.plannedPace} /km` : "—"}
            </td>
          </tr>
          <tr className="font-semibold">
            <th scope="row" className="py-0.5 text-left font-normal text-fg-2">
              Realizada
            </th>
            <td className="py-0.5">{run.typeLabel}</td>
            <td className="num py-0.5 text-right">{km(run.km)}</td>
            <td className="num py-0.5 text-right">
              {run.pace ? `${run.pace} /km` : "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </Link>
  );
}

const MINE_STATUS_COLOR: Record<MineStatus, string> = {
  cumplida: "var(--load-low)",
  otra: "var(--load-mod)",
  pendiente: "var(--fg-2)",
  no_hecha: "var(--load-high)",
};

function MineStatusPill({ status }: { status: MineStatus }) {
  const c = MINE_STATUS_COLOR[status];
  return (
    <span
      className="flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
      }}
    >
      {status === "cumplida" ? "✓ " : status === "no_hecha" ? "✕ " : ""}
      {MINE_STATUS_LABEL[status]}
    </span>
  );
}

/** Carreras que no vinculan con ninguna sesión mía ni cumplen la sugerencia de su semana. */
function UnplannedList({ items }: { items: RunBrief[] }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5">
      {items.map((r) => (
        <li key={r.id}>
          <Link
            href={`/actividad/${r.id}`}
            className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-dashed border-line-strong px-3 py-2"
          >
            <span className="min-w-0 flex-1 text-[14px]">
              <b>{r.typeLabel}</b>
              <span className="text-fg-2">
                {" "}
                · {r.dayLabel}
                {r.km ? ` · ${r.km} km` : ""}
                {r.pace ? ` · ${r.pace} /km` : ""}
              </span>
            </span>
            <span className="flex-none rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-semibold text-fg-2">
              Sesión no prevista
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MinePill() {
  return (
    <span className="flex-none rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[11px] font-semibold text-lime-text">
      Puesta por mí
    </span>
  );
}

function HiddenPill({ hidden }: { hidden: Hidden }) {
  return (
    <span className="flex-none rounded-full border border-line-strong px-2.5 py-1 text-[12px] font-semibold text-fg-2">
      {hidden.by === "dismissed" ? "Quitada" : "Sustituida"}
    </span>
  );
}

/** Sugerencia de una semana próxima: tocar para editarla, moverla o quitarla. */
function Suggestion({ s, hidden }: { s: WeekSession; hidden: Hidden | null }) {
  if (hidden?.by === "replaced") return null;
  if (hidden?.by === "dismissed") {
    return (
      <div className="mt-1 flex items-center gap-2 text-[13px] text-fg-2">
        <span className="line-through">
          {s.label} · {s.dayLabel}
        </span>
        <RestoreSuggestion weekStart={s.start} />
      </div>
    );
  }
  return (
    <Link
      href={`/plan/sesion/nueva?semana=${s.start}`}
      className="-ml-1 mt-0.5 flex min-h-[44px] items-center gap-1.5 px-1 text-[13px]"
    >
      <SessionDot kind={s.session} /> <b>{s.label}</b>
      <span className="text-fg-2">· {s.dayLabel}</span>
      <span className="text-fg-3" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

function ShiftPill({ kind }: { kind: keyof typeof SHIFT_META }) {
  const c = SHIFT_META[kind].color;
  return (
    <span
      className="relative rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
      }}
    >
      {SHIFT_META[kind].label}
    </span>
  );
}

const SESSION_COLOR: Record<SessionKind, string> = {
  tirada_larga: "var(--t-tirada_larga)",
  calidad: "var(--t-series)",
  calidad_corta: "var(--t-tempo)",
  suave: "var(--t-rodaje)",
  suave_opcional: "var(--fg-3)",
  suave_corto: "var(--t-recuperacion)",
  solo_carrera: "var(--t-competicion)",
};

function SessionDot({ kind }: { kind: SessionKind }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full align-middle"
      style={{ background: SESSION_COLOR[kind] }}
      aria-hidden="true"
    />
  );
}

/** Sesión de la semana en curso: qué, cuándo, por qué y cómo va. */
function SessionBlock({
  s,
}: {
  s: WeekSession & {
    status: WeekStatus;
    rescheduledFrom: string | null;
    canReschedule: boolean;
    rescheduleTo: string | null;
    hidden: Hidden | null;
  };
}) {
  if (s.hidden) {
    return (
      <div className="relative mt-4 rounded-2xl border border-line bg-inset p-3.5 text-[13px] text-fg-2">
        <div className="text-[12px]">Sesión de la semana</div>
        {s.hidden.by === "dismissed" ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2">
            <span>
              Quitaste la sugerencia (
              <span className="line-through">
                {s.label} · {s.dayLabel}
              </span>
              ).
            </span>
            <RestoreSuggestion weekStart={s.start} />
          </div>
        ) : (
          <p className="mt-1">
            La sugerencia ({s.label} · {s.dayLabel}) la sustituye tu sesión.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="relative mt-4 rounded-2xl border border-line bg-inset p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] text-fg-2">Sesión de la semana</div>
        <StatusPill status={s.status} />
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <SessionDot kind={s.session} />
        <span className="font-display text-[20px] font-bold">{s.label}</span>
      </div>
      <div className="mt-0.5 text-[14px] first-letter:uppercase">
        {s.dayLabel}
        {s.when ? `, ${s.when}` : ""}
      </div>
      {s.rescheduledFrom && (
        <div className="mt-0.5 text-[12px] text-fg-2">
          Reorganizada (antes, el {fmtDay(s.rescheduledFrom)}).
        </div>
      )}
      {s.race && <RaceMark race={s.race} />}
      <p className="mt-1.5 text-[12px] leading-snug text-fg-2">{s.reason}</p>
      {s.status === "dia_pasado" &&
        (s.canReschedule && s.rescheduleTo ? (
          <RescheduleButton weekStart={s.start} to={fmtDay(s.rescheduleTo)} />
        ) : (
          <p className="mt-2 text-[12px] text-fg-2">
            El día previsto ya pasó y no queda otro día válido esta semana para
            esta sesión.
          </p>
        ))}
      <p className="mt-1.5 text-[11px] text-fg-3">
        Sugerencia, no obligación: si no te encuentras bien, cambia a suave o
        descansa.
      </p>
      <Link
        href={`/plan/sesion/nueva?semana=${s.start}`}
        className="mt-1 -mb-1.5 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-fg underline-offset-2 hover:underline"
      >
        Editar, mover o quitar ›
      </Link>
    </div>
  );
}

const STATUS_COLOR: Record<WeekStatus, string> = {
  cumplida: "var(--load-low)",
  otra: "var(--load-mod)",
  pendiente: "var(--fg-2)",
  dia_pasado: "var(--load-mod)",
  no_cumplida: "var(--load-high)",
  opcional: "var(--fg-3)",
};

function StatusPill({ status }: { status: WeekStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span
      className="flex-none rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
      }}
    >
      {status === "cumplida" ? "✓ " : status === "no_cumplida" ? "✕ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** La carrera objetivo marcada en su semana. */
function RaceMark({ race }: { race: { name: string; dayLabel: string } }) {
  return (
    <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--t-competicion)_16%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--t-competicion)]">
      <span aria-hidden="true">🏁</span> {race.name} · {race.dayLabel}
    </div>
  );
}
