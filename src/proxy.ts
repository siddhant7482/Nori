import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, validSession } from "@/lib/session";

/* ============================================================
   Every request, before anything renders: signed in, or sent to
   the login. This covers pages, server actions and API routes
   alike, whether the request came through Caddy or straight to the
   container's port.

   Two things stay open:
   - /login, obviously
   - /api/status, which the hub and Sentry poll with no browser and
     no cookie. It says what the hub already shows on its deck.
   ============================================================ */

const OPEN = new Set(["/login", "/api/status"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.has(pathname)) return NextResponse.next();
  if (validSession(request.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in to Nori first." }, { status: 401 });
  const to = new URL("/login", request.url);
  if (pathname + search !== "/") to.searchParams.set("next", pathname + search);
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
