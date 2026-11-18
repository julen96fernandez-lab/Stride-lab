import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    // Carreras a mano con archivo (.gpx/.tcx/.fit): Vercel admite hasta 4,5 MB por petición.
    serverActions: { bodySizeLimit: "4mb" },
    // Volver a una pestaña ya visitada la enseña al instante (5 min); las acciones que cambian
    // datos vacían esta caché del cliente (refresh / updateTag) y la barra refresca por detrás.
    staleTimes: { dynamic: 300, static: 300 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
