"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, COOKIE, lockedFor, loginConfigured, newSession, recordAttempt, safeNext } from "@/lib/session";

export type LoginState = { error: string | null };

function wait(seconds: number): string {
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  if (!loginConfigured()) return { error: "No password is set on this server yet. Nori stays locked until LOGIN_PASSWORD_HASH and SESSION_SECRET are in its .env.local." };
  const locked = lockedFor();
  if (locked) return { error: `Too many wrong passwords. Try again in ${wait(locked)}.` };

  const ok = checkPassword(String(form.get("password") ?? ""), process.env.LOGIN_PASSWORD_HASH);
  recordAttempt(ok);
  if (!ok) {
    const now = lockedFor();
    return { error: now ? `That's not the password. Too many wrong ones: wait ${wait(now)}.` : "That's not the password." };
  }

  const s = newSession()!;
  /* Secure when Nori is ever served over HTTPS; today it is HTTP on the
   * LAN and over Tailscale, where a Secure cookie would never be sent. */
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(COOKIE, s.value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: s.maxAge, secure });
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
