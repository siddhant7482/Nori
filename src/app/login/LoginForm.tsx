"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: configured ? null : "No password is set on this server yet, so Nori stays locked." });
  return (
    <form action={action} className="login-form">
      {/* Lets a password manager file the password under something. */}
      <input className="vh" type="text" name="username" autoComplete="username" defaultValue="commandhq" readOnly tabIndex={-1} aria-hidden="true" />
      <input type="hidden" name="next" value={next} />
      <label className="field" htmlFor="password">
        Password
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required disabled={!configured} />
      </label>
      <button className="btn" type="submit" disabled={pending || !configured}>{pending ? "Checking…" : "Sign in"}</button>
      <p className="login-err" role="alert" aria-live="polite">{state.error}</p>
    </form>
  );
}
