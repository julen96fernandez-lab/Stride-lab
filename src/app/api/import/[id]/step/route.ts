import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { blobRangeSource, putPrivate } from "@/lib/import/blob";
import { runImportStep } from "@/lib/import/pipeline";
import { checkRun, getImportView, toView } from "@/lib/import/status";
import { dataChangedInRoute } from "@/lib/cache/invalidate";

// Plan Hobby: 300 s por invocación. Se trabaja ~240 s y se guarda el punto de control.
export const maxDuration = 300;
const BUDGET_MS = 240_000;

/** Avanza la importación un tramo. La pantalla lo llama en bucle hasta que termina. */
export async function POST(_request: Request, ctx: RouteContext<"/api/import/[id]/step">) {
  const started = Date.now();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });
  const view = await getImportView(id);
  if (!view) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (view.status === "done") return NextResponse.json({ import: view, check: await checkRun() });

  const { blobUrl } = (await db().query.imports.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const row = await runImportStep(
    id,
    {
      db: db(),
      source: blobRangeSource(blobUrl),
      putRoute: (pathname, body) => putPrivate(pathname, body, "application/gpx+xml"),
    },
    started + BUDGET_MS,
  );
  // Cada tramo puede añadir o recalcular carreras: la caché de las pantallas caduca ya.
  dataChangedInRoute();
  const out = toView(row);
  return NextResponse.json({ import: out, check: out.status === "done" ? await checkRun() : null });
}
