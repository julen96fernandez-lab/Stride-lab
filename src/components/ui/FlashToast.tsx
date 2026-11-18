"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { takeFlash } from "@/lib/ui/feedback";
import { toast } from "./Toaster";

/** Muestra el aviso que dejó una acción antes de redirigir (?aviso=…) y lo quita de la URL. */
export function FlashToast() {
  const path = usePathname();
  useEffect(() => {
    const f = takeFlash(window.location.pathname + window.location.search + window.location.hash);
    if (!f) return;
    window.history.replaceState(window.history.state, "", f.clean);
    if (f.toast.text) toast.show(f.toast.kind, f.toast.text);
  }, [path]);
  return null;
}
