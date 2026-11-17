import { NextResponse } from "next/server";
import { checkRun, getImportView } from "@/lib/import/status";

export async function GET(_request: Request, ctx: RouteContext<"/api/import/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });
  const view = await getImportView(id);
  if (!view) return NextResponse.json({ error: "No existe" }, { status: 404 });
  return NextResponse.json({ import: view, check: view.status === "done" ? await checkRun() : null });
}
