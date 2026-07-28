import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { auth } from "@/lib/auth";
import { hasGoogleAuth } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { callbackUrl, error } = await searchParams;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in to reach your receipts.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
        >
          {error === "CredentialsSignin"
            ? "That email and password do not match."
            : "Something went wrong signing in. Please try again."}
        </p>
      )}

      <AuthForm
        mode="signin"
        redirectTo={callbackUrl ?? "/app"}
        googleEnabled={hasGoogleAuth}
      />
    </div>
  );
}
