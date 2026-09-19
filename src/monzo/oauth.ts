import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { connection } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/* ============================================================
   Nori's login to Monzo, and nothing else.

   Refresh tokens are single use: refreshing invalidates the old
   access token AND the old refresh token. Two refreshes racing each
   other (the five-minute timer and a page load, say) would leave
   whichever lost holding a dead token, and Nori locked out. So a
   refresh happens inside a row lock, and whoever waits on the lock
   re-reads the row and finds a fresh token already there.
   ============================================================ */

const AUTH = "https://auth.monzo.com/";
const TOKEN = "https://api.monzo.com/oauth2/token";

export function isConfigured(): boolean {
  return Boolean(process.env.MONZO_CLIENT_ID && process.env.MONZO_CLIENT_SECRET && process.env.MONZO_REDIRECT_URI);
}

export function authorizeUrl(state: string): string {
  const u = new URL(AUTH);
  u.searchParams.set("client_id", process.env.MONZO_CLIENT_ID!);
  u.searchParams.set("redirect_uri", process.env.MONZO_REDIRECT_URI!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user_id: string;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { message?: string; code?: string };
      detail = b.message ?? b.code ?? detail;
    } catch {}
    throw new Error(`Monzo refused the token request (${res.status}): ${detail}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Trades the authorisation code for tokens and stores them, encrypted.
 *  Starts the five-minute clock on full history. */
export async function exchangeCode(code: string): Promise<void> {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    client_id: process.env.MONZO_CLIENT_ID!,
    client_secret: process.env.MONZO_CLIENT_SECRET!,
    redirect_uri: process.env.MONZO_REDIRECT_URI!,
    code,
  });
  /* Nori holds one account's history. Authorising a different Monzo
   * account would quietly pour its payments into the same budgets. */
  const [existing] = await db.select({ user: connection.monzoUserId }).from(connection).where(eq(connection.id, 1));
  if (existing?.user && existing.user !== t.user_id) {
    throw new Error("That's a different Monzo account from the one Nori already reads. Nori keeps one account's history and won't mix a second into it.");
  }
  const row = {
    monzoUserId: t.user_id,
    accessToken: encryptSecret(t.access_token),
    refreshToken: t.refresh_token ? encryptSecret(t.refresh_token) : null,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
    authorisedAt: new Date(),
    approvedAt: null,
    lastError: null,
    syncLeaseUntil: null,
  };
  await db
    .insert(connection)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: connection.id, set: row });
}

/** A usable access token, refreshed first if it is within five minutes
 *  of expiring. Throws when there is no connection or it cannot be
 *  refreshed (a non-confidential client, or a revoked grant). */
export async function accessToken(): Promise<string> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(connection).where(eq(connection.id, 1)).for("update");
    if (!c) throw new Error("Monzo is not connected.");
    if (c.expiresAt.getTime() - Date.now() > 5 * 60_000) return decryptSecret(c.accessToken);
    if (!c.refreshToken) throw new Error("The Monzo token has expired and there is no refresh token. The client must be CONFIDENTIAL; connect Monzo again.");
    const t = await tokenRequest({
      grant_type: "refresh_token",
      client_id: process.env.MONZO_CLIENT_ID!,
      client_secret: process.env.MONZO_CLIENT_SECRET!,
      refresh_token: decryptSecret(c.refreshToken),
    });
    await tx
      .update(connection)
      .set({
        accessToken: encryptSecret(t.access_token),
        refreshToken: t.refresh_token ? encryptSecret(t.refresh_token) : c.refreshToken,
        expiresAt: new Date(Date.now() + t.expires_in * 1000),
      })
      .where(eq(connection.id, 1));
    return t.access_token;
  });
}

export async function getConnection() {
  const [c] = await db.select().from(connection).where(eq(connection.id, 1));
  return c ?? null;
}

/** Take the sync lease for `minutes`. False when another sync holds it. */
export async function takeLease(minutes: number): Promise<boolean> {
  const r = await db
    .update(connection)
    .set({ syncLeaseUntil: sql`now() + make_interval(mins => ${minutes})` })
    .where(sql`${connection.id} = 1 and (${connection.syncLeaseUntil} is null or ${connection.syncLeaseUntil} < now())`)
    .returning({ id: connection.id });
  return r.length > 0;
}

export async function releaseLease(): Promise<void> {
  await db.update(connection).set({ syncLeaseUntil: null }).where(eq(connection.id, 1));
}
