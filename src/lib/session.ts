import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/* ============================================================
   The login. One person, one password, one signed cookie.

   Deliberately small enough to read in one sitting, because it
   stands between the home Wi-Fi and a bank account:

   - the password is never stored, only an scrypt hash of it
     (LOGIN_PASSWORD_HASH), and it is compared in constant time
   - the session is a cookie holding an expiry, signed with
     SESSION_SECRET. Nothing to look up, nothing to leak: forge it
     and the signature fails, keep it past 30 days and it expires
   - changing SESSION_SECRET signs every device out at once. That
     is the answer to a lost phone.
   - no password set means nobody gets in. It fails closed.
   ============================================================ */

export const COOKIE = "nori_session";
export const SESSION_DAYS = 30;

const b64 = (b: Buffer) => b.toString("base64url");

/** scrypt:N:r:p:salt:hash. Colons, not the usual dollar signs: Next
 *  expands $NAME inside .env files and would quietly eat the hash. N=2^15 costs about 32 MB and a tenth of a
 *  second per guess, which is nothing to you and a lot to a script. */
export function hashPassword(password: string): string {
  const N = 32768, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, r, p, b64(salt), b64(hash)].join(":");
}

export function checkPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [kind, n, r, p, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), want.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(got, want);
}

function secret(): Buffer | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? Buffer.from(s) : null;
}

function mac(body: string, key: Buffer): string {
  return b64(createHmac("sha256", key).update(body).digest());
}

export function newSession(now = Date.now()): { value: string; maxAge: number } | null {
  const key = secret();
  if (!key) return null;
  const maxAge = SESSION_DAYS * 86_400;
  const body = b64(Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + maxAge * 1000 })));
  return { value: `${body}.${mac(body, key)}`, maxAge };
}

export function validSession(token: string | undefined, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const want = Buffer.from(mac(body, key)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  try {
    const { v, exp } = JSON.parse(Buffer.from(body, "base64url").toString()) as { v: number; exp: number };
    return v === 1 && typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function loginConfigured(): boolean {
  return Boolean(process.env.LOGIN_PASSWORD_HASH && secret());
}

/* ------------------------------------------------------------
   Slowing down guessing. One person uses this login, so the limit
   is global rather than per address (an address behind Caddy is
   whatever Caddy says it is). After five wrong passwords in a row
   each attempt has to wait, doubling to fifteen minutes. The right
   password resets it.
   ------------------------------------------------------------ */
const guard = { fails: 0, until: 0 };

export function lockedFor(now = Date.now()): number {
  return Math.max(0, Math.ceil((guard.until - now) / 1000));
}

export function recordAttempt(ok: boolean, now = Date.now()) {
  if (ok) {
    guard.fails = 0;
    guard.until = 0;
    return;
  }
  guard.fails++;
  if (guard.fails >= 5) guard.until = now + Math.min(15 * 60, 2 ** (guard.fails - 5) * 15) * 1000;
}

/** A place to send someone after signing in: only paths on this app. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/login") ? next : "/";
}
