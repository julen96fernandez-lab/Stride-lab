"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { RouteShape } from "@/lib/db/queries";

import { onThemeChange } from "@/components/charts/EChart";

const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const ROUTE = "var(--route)";

/** Tema efectivo ahora mismo (selector de Perfil o el del sistema). */
function isLight(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "light") return true;
  if (t === "dark") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/**
 * Mapa de la ruta. Debajo siempre se dibuja la ruta en SVG (funciona sin red de
 * teselas); encima se carga MapLibre con el mapa base oscuro y, si carga, aparece.
 */
export function RouteMap({
  points,
  bbox,
  shape,
  height = 300,
}: {
  points: [number, number][]; // [lat, lon]
  bbox: readonly [number | null, number | null, number | null, number | null];
  shape: RouteShape | null;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => onThemeChange(() => setThemeKey((k) => k + 1)), []);

  useEffect(() => {
    if (!ref.current || points.length < 2 || bbox.some((v) => v === null)) return;
    let map: import("maplibre-gl").Map | null = null;
    let cancelled = false;
    void import("maplibre-gl").then(({ Map: MlMap }) => {
      if (cancelled || !ref.current) return;
      map = new MlMap({
        container: ref.current,
        style: isLight() ? STYLE_LIGHT : STYLE_DARK,
        bounds: [
          [bbox[0]!, bbox[1]!],
          [bbox[2]!, bbox[3]!],
        ],
        fitBoundsOptions: { padding: 36 },
        attributionControl: { compact: true },
        cooperativeGestures: true,
        pitchWithRotate: false,
        dragRotate: false,
      });
      const css = getComputedStyle(document.documentElement);
      const LIME = css.getPropertyValue("--route").trim() || "#c8f23a";
      const FG = css.getPropertyValue("--fg").trim() || "#f4f5ee";
      const BG = css.getPropertyValue("--bg").trim() || "#0a0b09";
      map.on("load", () => {
        if (!map) return;
        const coords = points.map(([lat, lon]) => [lon, lat]);
        map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } });
        map.addLayer({ id: "glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": LIME, "line-width": 12, "line-opacity": 0.22, "line-blur": 6 } });
        map.addLayer({ id: "line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": LIME, "line-width": 3.5 } });
        map.addSource("ends", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: coords[0] } },
              { type: "Feature", properties: { kind: "end" }, geometry: { type: "Point", coordinates: coords[coords.length - 1] } },
            ],
          },
        });
        map.addLayer({
          id: "ends",
          type: "circle",
          source: "ends",
          paint: {
            "circle-radius": 6,
            "circle-color": ["match", ["get", "kind"], "start", FG, LIME],
            "circle-stroke-color": BG,
            "circle-stroke-width": 2.5,
          },
        });
        setReady(true);
      });
      map.on("error", () => {
        /* sin teselas: se queda la ruta en SVG */
      });
    });
    return () => {
      cancelled = true;
      setReady(false);
      map?.remove();
    };
  }, [points, bbox, themeKey]);

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-map" style={{ height }}>
      {shape && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke="var(--line)" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
          <path d={shape.d} fill="none" stroke={ROUTE} strokeOpacity="0.22" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={shape.d} fill="none" stroke={ROUTE} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={shape.start[0]} cy={shape.start[1]} r="2" fill="var(--fg)" stroke="var(--bg)" strokeWidth="0.8" />
          <circle cx={shape.end[0]} cy={shape.end[1]} r="2" fill={ROUTE} stroke="var(--bg)" strokeWidth="0.8" />
        </svg>
      )}
      <div
        ref={ref}
        className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
        role="img"
        aria-label="Mapa del recorrido"
      />
    </div>
  );
}

/** Miniatura de ruta para listas (SVG puro). */
export function RouteThumb({ shape, size = 64 }: { shape: RouteShape | null; size?: number }) {
  if (!shape) {
    return (
      <div className="flex flex-none items-center justify-center rounded-2xl border border-line bg-map text-fg-3" style={{ width: size, height: size }}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 17h16M6 17l2-8h8l2 8M9 9V6h6v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="flex-none rounded-2xl border border-line bg-map" aria-hidden="true">
      <path d={shape.d} fill="none" stroke={ROUTE} strokeOpacity="0.25" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <path d={shape.d} fill="none" stroke={ROUTE} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={shape.end[0]} cy={shape.end[1]} r="5" fill={ROUTE} stroke="var(--bg)" strokeWidth="2" />
    </svg>
  );
}
