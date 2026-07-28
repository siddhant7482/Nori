import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard for /app/*.
 *
 * This is UX, not a security boundary. It only checks that a session cookie
 * is present — it does not verify the signature, because doing so needs Node
 * APIs that the Edge middleware runtime does not provide. Every route handler
 * and server component re-checks the real session through requireScope().
 *
 * Treat any data path that relies on middleware alone as unprotected.
 */
const PROTECTED = /^\/app(\/|$)/;

// Auth.js names the cookie differently under HTTPS.
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!PROTECTED.test(pathname)) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/signin";
  url.search = "";
  url.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app/:path*"],
};
