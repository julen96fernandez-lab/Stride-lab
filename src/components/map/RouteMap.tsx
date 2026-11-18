"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
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

/** Control del mapa desde fuera, sin re-renderizar (para el cursor de los gráficos). */
export interface MapApi {
  /** Punto del instante señalado; null lo oculta. */
  setCursor(lat: number | null, lon: number | null): void;
  /** Tramo resaltado ([lat, lon][]); null lo quita. */
  setHighlight(points: [number, number][] | null): void;
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
  apiRef,
}: {
  points: [number, number][]; // [lat, lon]
  bbox: readonly [number | null, number | null, number | null, number | null];
  shape: RouteShape | null;
  height?: number;
  apiRef?: MutableRefObject<MapApi | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Último estado pedido, para aplicarlo cuando el mapa termine de cargar.
  const want = useRef<{ cursor: [number, number] | null; hl: [number, number][] | null }>({ cursor: null, hl: null });
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
        // Tramo resaltado (parcial tocado) y cursor del instante señalado.
        map.addSource("hl", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "hl", type: "line", source: "hl", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": FG, "line-width": 6, "line-opacity": 0.9 } });
        const dot = document.createElement("div");
        dot.setAttribute("aria-hidden", "true");
        dot.style.cssText = `width:16px;height:16px;border-radius:50%;background:${LIME};border:3px solid ${BG};box-shadow:0 0 0 1.5px ${FG};will-change:transform;display:none`;
        void import("maplibre-gl").then(({ Marker }) => {
          if (!map) return;
          const marker = new Marker({ element: dot }).setLngLat(coords[0] as [number, number]).addTo(map);
          const api: MapApi = {
            setCursor(lat, lon) {
              want.current.cursor = lat === null || lon === null ? null : [lat, lon];
              if (lat === null || lon === null) {
                dot.style.display = "none";
                return;
              }
              dot.style.display = "block";
              marker.setLngLat([lon, lat]);
            },
            setHighlight(pts) {
              want.current.hl = pts;
              const src = map?.getSource("hl") as import("maplibre-gl").GeoJSONSource | undefined;
              src?.setData(
                pts && pts.length > 1
                  ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map(([la, lo]) => [lo, la]) } }
                  : { type: "FeatureCollection", features: [] },
              );
            },
          };
          if (apiRef) apiRef.current = api;
          if (want.current.cursor) api.setCursor(...want.current.cursor);
          if (want.current.hl) api.setHighlight(want.current.hl);
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
      if (apiRef) apiRef.current = null;
      map?.remove();
    };
  }, [points, bbox, themeKey, apiRef]);

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
