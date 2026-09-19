import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasEncryptionKey } from "@/lib/crypto";
import { authorizeUrl, isConfigured } from "@/monzo/oauth";

export const dynamic = "force-dynamic";

/* Starts the Monzo authorisation. Refuses to begin without the
 * encryption key: better to stop here than to receive a token with
 * nowhere safe to put it. */
export async function GET() {
  if (!isConfigured()) return NextResponse.json({ error: "Monzo is not configured. Set MONZO_CLIENT_ID, MONZO_CLIENT_SECRET and MONZO_REDIRECT_URI." }, { status: 500 });
  if (!hasEncryptionKey()) return NextResponse.json({ error: "TOKEN_ENCRYPTION_KEY is not set. The Monzo tokens are stored encrypted; generate a key first." }, { status: 500 });

  /* CSRF guard: this value comes back on the redirect and must match. */
  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("nori_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state));
}
