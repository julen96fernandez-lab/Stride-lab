"use client";

import { Segmented } from "./Segmented";
import { useSyncExternalStore } from "react";

type Choice = "system" | "light" | "dark";
const KEY = "stride-theme";
const OPTIONS: { v: Choice; label: string }[] = [
  { v: "system", label: "Sistema" },
  { v: "light", label: "Día" },
  { v: "dark", label: "Noche" },
];

function read(): Choice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener("stride-theme", cb);
  return () => window.removeEventListener("stride-theme", cb);
};

function apply(choice: Choice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* sin almacenamiento: se aplica solo en esta visita */
  }
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  const light = choice === "light" || (choice === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", choice === "system" ? (m.getAttribute("media")?.includes("light") ? "#F3F3EE" : "#0A0B09") : light ? "#F3F3EE" : "#0A0B09");
  });
  window.dispatchEvent(new Event("stride-theme"));
}

/** Selector de tema: Sistema (por defecto), Día o Noche. Se guarda en este dispositivo. */
export function ThemePicker() {
  const current = useSyncExternalStore(subscribe, read, () => "system" as Choice);
  return (
    <div className="card p-5">
      <div className="eyebrow">Apariencia</div>
      <div className="mt-3">
        <Segmented
          stretch
          label="Tema"
          value={current}
          onChange={(k) => apply(k as Choice)}
          items={OPTIONS.map((o) => ({
            key: o.v,
            label: (
              <>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                {o.v === "light" ? (
                  <>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </>
                ) : o.v === "dark" ? (
                  <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
                ) : (
                  <>
                    <rect x="3" y="4" width="18" height="13" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </>
                )}
              </svg>
                {o.label}
              </>
            ),
          }))}
        />
      </div>
      <p className="mt-3 text-[12px] text-fg-2">«Sistema» sigue el modo claro u oscuro del iPhone.</p>
    </div>
  );
}
