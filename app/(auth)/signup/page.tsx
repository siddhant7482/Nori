import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { auth } from "@/lib/auth";
import { hasGoogleAuth } from "@/lib/env";

export const metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { callbackUrl } = await searchParams;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A personal workspace is set up for you straight away.
        </p>
      </div>

      <AuthForm
        mode="signup"
        redirectTo={callbackUrl ?? "/app"}
        googleEnabled={hasGoogleAuth}
      />
    </div>
  );
}
