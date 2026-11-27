import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { latestHealthScan, startHealthScan, toHealthScanView } from "@/lib/health/census-run";

/** Última revisión de datos de salud (o ninguna). */
export async function GET() {
  const row = await latestHealthScan(db());
  return NextResponse.json({ scan: row ? await toHealthScanView(db(), row) : null });
}

/** Empieza una revisión del último zip importado (o devuelve la que esté a medias). */
export async function POST() {
  const row = await startHealthScan(db());
  if (!row) return NextResponse.json({ error: "Aún no hay ningún zip importado." }, { status: 404 });
  return NextResponse.json({ scan: await toHealthScanView(db(), row) });
}
