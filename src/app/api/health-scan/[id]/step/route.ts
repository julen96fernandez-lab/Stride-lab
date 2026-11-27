import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { blobRangeSource } from "@/lib/import/blob";
import { getHealthScan, runHealthScanStep, toHealthScanView } from "@/lib/health/census-run";

// Igual que el importador: ~240 s de trabajo por invocación y punto de control.
export const maxDuration = 300;
const BUDGET_MS = 240_000;

/** Avanza la revisión un tramo. Solo cuenta: no guarda lecturas ni toca las carreras. */
export async function POST(_request: Request, ctx: RouteContext<"/api/health-scan/[id]/step">) {
  const started = Date.now();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });
  const row = await getHealthScan(db(), id);
  if (!row) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const out = row.status === "done" ? row : await runHealthScanStep(id, { db: db(), source: blobRangeSource(row.blobUrl) }, started + BUDGET_MS);
  return NextResponse.json({ scan: await toHealthScanView(db(), out) });
}
