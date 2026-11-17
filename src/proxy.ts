import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth/session";

/** Rutas accesibles sin sesión. */
const PUBLIC_PATHS = new Set(["/login"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const ok = await isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Todo salvo estáticos, iconos, manifest y service worker.
    "/((?!_next/static|_next/image|icons/|manifest.webmanifest|sw.js|favicon.ico).*)",
  ],
};
