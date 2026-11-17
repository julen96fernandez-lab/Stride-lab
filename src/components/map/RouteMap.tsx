"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { RouteShape } from "@/lib/db/queries";

const STYLE = "https://tiles.openfreemap.org/styles/dark";
const LIME = "#C8F23A";

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

  useEffect(() => {
    if (!ref.current || points.length < 2 || bbox.some((v) => v === null)) return;
    let map: import("maplibre-gl").Map | null = null;
    let cancelled = false;
    void import("maplibre-gl").then(({ Map: MlMap }) => {
      if (cancelled || !ref.current) return;
      map = new MlMap({
        container: ref.current,
        style: STYLE,
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
            "circle-color": ["match", ["get", "kind"], "start", "#F4F5EE", LIME],
            "circle-stroke-color": "#0A0B09",
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
      map?.remove();
    };
  }, [points, bbox]);

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-[#0E100C]" style={{ height }}>
      {shape && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
          <path d={shape.d} fill="none" stroke={LIME} strokeOpacity="0.22" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={shape.d} fill="none" stroke={LIME} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={shape.start[0]} cy={shape.start[1]} r="2" fill="#F4F5EE" stroke="#0A0B09" strokeWidth="0.8" />
          <circle cx={shape.end[0]} cy={shape.end[1]} r="2" fill={LIME} stroke="#0A0B09" strokeWidth="0.8" />
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
      <div className="flex flex-none items-center justify-center rounded-2xl border border-line bg-[#0E100C] text-fg-3" style={{ width: size, height: size }}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 17h16M6 17l2-8h8l2 8M9 9V6h6v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="flex-none rounded-2xl border border-line bg-[#0E100C]" aria-hidden="true">
      <path d={shape.d} fill="none" stroke={LIME} strokeOpacity="0.25" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <path d={shape.d} fill="none" stroke={LIME} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={shape.end[0]} cy={shape.end[1]} r="5" fill={LIME} stroke="#0A0B09" strokeWidth="2" />
    </svg>
  );
}
