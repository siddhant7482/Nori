"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  registerAction,
  signInAction,
  type FormState,
} from "@/lib/auth/actions";

type Mode = "signin" | "signup";

export function AuthForm({
  mode,
  redirectTo = "/app",
  googleEnabled,
}: {
  mode: Mode;
  redirectTo?: string;
  googleEnabled: boolean;
}) {
  const action = mode === "signup" ? registerAction : signInAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <div className="space-y-5">
      {googleEnabled && (
        <>
          <form action={`/api/auth/signin/google`} method="post">
            <input type="hidden" name="callbackUrl" value={redirectTo} />
            <Button type="submit" variant="outline" className="w-full gap-2">
              <GoogleMark />
              Continue with Google
            </Button>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="redirectTo" value={redirectTo} />

        {mode === "signup" && (
          <Field
            id="name"
            label="Name"
            type="text"
            autoComplete="name"
            placeholder="Alex Morgan"
            error={state.fieldErrors?.name}
          />
        )}

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={state.fieldErrors?.email}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={mode === "signup" ? "At least 10 characters" : "••••••••••"}
          error={state.fieldErrors?.password}
          hint={
            mode === "signup"
              ? "Length matters far more than symbols. A short phrase works well."
              : undefined
          }
        />

        {state.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.error}
          </p>
        )}

        <Submit mode={mode} />
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/signin" className="text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Nori?{" "}
            <Link href="/signup" className="text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Submit({ mode }: { mode: Mode }) {
  // useFormStatus must be read from a child of the form, not the form itself.
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="glow-primary w-full gap-2" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {mode === "signup" ? "Creating account…" : "Signing in…"}
        </>
      ) : (
        <>
          {mode === "signup" ? "Create account" : "Sign in"}
          <ArrowRight className="size-4" aria-hidden />
        </>
      )}
    </Button>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        className={cn(error && "border-destructive/60")}
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84C6.71 7.29 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
