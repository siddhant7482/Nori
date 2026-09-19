import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, loginConfigured, safeNext, SESSION_DAYS, validSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Nori" };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (validSession((await cookies()).get(COOKIE)?.value)) redirect(next);
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">nori<i /></div>
        <h1>Sign in</h1>
        <p className="sub">Nori shows your bank account, so it asks who you are first. This device then stays signed in for {SESSION_DAYS} days.</p>
        <LoginForm next={next} configured={loginConfigured()} />
      </div>
    </main>
  );
}
