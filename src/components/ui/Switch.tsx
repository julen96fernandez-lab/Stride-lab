"use client";

/** Interruptor con el botón animado (deslizamiento y estiramiento al pulsar). */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch flex min-h-[44px] items-center gap-2.5 text-[13px] font-semibold text-fg-2"
    >
      <span className={`switch-track relative h-[26px] w-[44px] flex-none rounded-full ${checked ? "bg-lime" : "bg-ov-2"}`}>
        <span className={`switch-thumb absolute top-[3px] left-[3px] h-5 w-5 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.35)] ${checked ? "translate-x-[18px] bg-lime-ink" : "bg-[var(--fg)]"}`} />
      </span>
      {label}
    </button>
  );
}
