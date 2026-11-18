"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { shouldRefresh, tabNavigation } from "@/lib/ui/tabs";

type Tab = { href: string; label: string; icon: ReactNode; match: (p: string) => boolean };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TABS: Tab[] = [
  {
    href: "/",
    label: "Inicio",
    match: (p) => p === "/",
    icon: <path {...stroke} d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/plan",
    label: "Plan",
    match: (p) => p.startsWith("/plan"),
    icon: (
      <g {...stroke}>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </g>
    ),
  },
  {
    href: "/actividad",
    label: "Actividad",
    match: (p) => p.startsWith("/actividad"),
    icon: <path {...stroke} d="M3 12h4l3-7 4 14 3-7h4" />,
  },
  {
    href: "/analisis",
    label: "Análisis",
    match: (p) => p.startsWith("/analisis"),
    icon: <path {...stroke} d="M5 20V10M12 20V4M19 20v-7" />,
  },
  {
    href: "/perfil",
    label: "Perfil",
    match: (p) => p.startsWith("/perfil"),
    icon: (
      <g {...stroke}>
        <circle cx="12" cy="8.5" r="3.6" />
        <path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" />
      </g>
    ),
  },
];

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  // Pestaña pulsada: se marca al instante, aunque el contenido aún esté llegando.
  const [pressed, setPressed] = useState<{ href: string; from: string } | null>(null);
  const shownPath = pressed && pressed.from === pathname ? pressed.href : pathname;
  const fromTab = useRef(false);
  const seenAt = useRef(new Map<string, number>());

  useEffect(() => {
    const now = Date.now();
    const last = seenAt.current.get(pathname);
    seenAt.current.set(pathname, now);
    if (!fromTab.current) return; // volver atrás o entrar por un enlace: el navegador recupera el scroll
    fromTab.current = false;
    // Entrar en una pestaña: siempre arriba.
    window.scrollTo({ top: 0 });
    // Ya visitada: se ve al instante lo guardado y, si tiene más de un minuto, se refresca por detrás.
    if (shouldRefresh(last, now)) router.refresh();
  }, [pathname, router]);

  return (
    <nav
      aria-label="Navegación principal"
      className="tabbar fixed inset-x-0 bottom-0 z-40 flex justify-center px-3"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
    >
      <ul className="flex w-full max-w-[420px] items-stretch rounded-[30px] border border-line-strong bg-glass p-1.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl backdrop-saturate-150">
        {TABS.map((tab) => {
          const active = tab.match(shownPath);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                prefetch
                onClick={(e) => {
                  const nav = tabNavigation(pathname, tab.href);
                  if (nav === "top") {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    return;
                  }
                  fromTab.current = true;
                  setPressed({ href: tab.href, from: pathname });
                }}
                aria-current={active ? "page" : undefined}
                className="flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-[24px] transition-colors"
              >
                <span
                  className={`flex h-[30px] w-[52px] items-center justify-center rounded-full transition-all duration-150 ${
                    active ? "bg-lime text-lime-ink shadow-[0_0_18px_rgba(200,242,58,0.45)]" : "text-fg-3"
                  }`}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    {tab.icon}
                  </svg>
                </span>
                <span className={`text-[11px] ${active ? "font-semibold text-fg" : "font-medium text-fg-3"}`}>
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
