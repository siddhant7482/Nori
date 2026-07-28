import Link from "next/link";
import { Check } from "lucide-react";
import { Logo } from "@/components/nori/logo";

const POINTS = [
  "Photograph a receipt and the figures fill themselves in",
  "Every total is checked against its own line items",
  "Low-confidence readings are flagged, never hidden",
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Form pane */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="inline-flex w-fit">
          <Logo />
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <p className="text-xs text-muted-foreground">
          Self-hosted. Your receipts stay on your own infrastructure.
        </p>
      </div>

      {/* Context pane — hidden below lg, where it would push the form off
          the fold on a phone. */}
      <div className="relative hidden overflow-hidden border-l bg-sidebar lg:block">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 size-[36rem] rounded-full bg-primary/10 blur-[120px]"
        />

        <div className="relative flex h-full flex-col justify-center px-14">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-balance">
            Receipts in.
            <br />
            <span className="text-muted-foreground">Ledger out.</span>
          </p>

          <ul className="mt-10 space-y-4">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                  <Check className="size-3" aria-hidden />
                </span>
                <span className="text-muted-foreground">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
