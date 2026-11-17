import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, aside }: { title: string; subtitle?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-[1.05] font-bold tracking-[-0.03em]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] text-fg-2">{subtitle}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Card({
  children,
  hero = false,
  className = "",
}: {
  children: ReactNode;
  hero?: boolean;
  className?: string;
}) {
  return <section className={`card ${hero ? "card-hero" : ""} p-5 ${className}`}>{children}</section>;
}

/** Valor grande + unidad. `value` null → «—» (nunca se inventa un dato). */
export function Stat({
  label,
  value,
  unit,
  hint,
  size = "md",
}: {
  label: string;
  value: ReactNode | null;
  unit?: string;
  hint?: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  const sizes = { md: "text-[34px]", lg: "text-[44px]", xl: "text-[60px]" };
  const empty = value === null || value === undefined;
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={`num ${sizes[size]} ${empty ? "text-fg-3" : "text-fg"}`}>{empty ? "—" : value}</span>
        {unit && !empty && <span className="text-[13px] font-medium text-fg-2">{unit}</span>}
      </div>
      {hint && <div className="mt-2 text-[12px] text-fg-2">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mt-2 flex items-baseline justify-between">
      <h2 className="font-display text-[20px] font-bold tracking-[-0.02em]">{children}</h2>
      {aside && <span className="text-[13px] text-fg-2">{aside}</span>}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const base =
    "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition active:scale-[0.98]";
  const styles =
    variant === "primary"
      ? "bg-lime text-lime-ink shadow-[0_8px_30px_-8px_rgba(200,242,58,0.55)]"
      : "border border-line-strong text-fg";
  return (
    <Link href={href} className={`${base} ${styles}`}>
      {children}
    </Link>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "lime" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        tone === "lime" ? "bg-lime text-lime-ink" : "border border-line-strong text-fg-2"
      }`}
    >
      {children}
    </span>
  );
}
