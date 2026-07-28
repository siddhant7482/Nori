"use server";

import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/lib/auth";
import { bootstrapWorkspace } from "@/lib/workspace";
import { hashPassword, registerSchema, loginSchema } from "./password";

export type FormState = {
  error?: string;
  /** Per-field messages, keyed by input name. */
  fieldErrors?: Record<string, string>;
};

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "");
    if (key && !out[key]) out[key] = i.message;
  }
  return out;
}

/** Next signals a successful redirect by throwing; that must not be caught. */
function isRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    // Registration cannot avoid disclosing that an address is taken — the
    // account either gets created or it does not. Say so plainly and point
    // at sign-in rather than pretending to succeed.
    return {
      fieldErrors: { email: "An account with this email already exists." },
    };
  }

  const passwordHash = await hashPassword(password);

  try {
    // One transaction: a user without a workspace can sign in but sees an
    // empty app, which presents as a mystery rather than as an error.
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash },
      });
      await bootstrapWorkspace(tx, user);
    });
  } catch (e) {
    // Unique violation from a concurrent signup with the same address.
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      return {
        fieldErrors: { email: "An account with this email already exists." },
      };
    }
    console.error("[auth] registration failed", e);
    return { error: "Could not create the account. Please try again." };
  }

  return signInAction(_prev, formData);
}

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const requested = String(formData.get("redirectTo") ?? "/app");
  // Only same-origin paths: an attacker-supplied absolute URL here turns the
  // login form into an open redirect.
  const redirectTo =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : "/app";

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo,
    });
  } catch (e) {
    if (isRedirect(e)) throw e;

    if (e instanceof AuthError) {
      // Deliberately identical for "no such account" and "wrong password" —
      // distinguishing them turns the login form into an account enumerator.
      return { error: "That email and password do not match." };
    }
    console.error("[auth] sign-in failed", e);
    return { error: "Something went wrong signing in. Please try again." };
  }

  return {};
}
