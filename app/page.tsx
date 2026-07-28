import Link from "next/link";
import {
  ArrowRight,
  Check,
  ScanLine,
  Sparkles,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { Logo } from "@/components/nori/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />

      <main className="flex-1">
        <Hero />
        <Features />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Self-hosted. Your receipts stay on your own infrastructure.</p>
        </div>
      </footer>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a
            href="#features"
            className="transition-colors hover:text-foreground"
          >
            Features
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button size="sm" className="glow-primary" asChild>
            <Link href="/signin">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="bg-grid absolute inset-0" aria-hidden />
      {/* Accent bloom behind the headline. Blurred to an ellipse so it reads
          as light rather than as a coloured rectangle. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[52rem] -translate-x-1/2 rounded-full bg-primary/12 blur-[120px]"
      />

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24">
        <Badge
          variant="outline"
          className="mb-6 gap-1.5 border-primary/25 bg-primary/8 py-1 text-primary"
        >
          <Sparkles className="size-3" aria-hidden />
          Tesseract OCR + structured LLM extraction
        </Badge>

        <h1 className="max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
          Photograph the receipt.
          <br />
          <span className="text-muted-foreground">Nori does the typing.</span>
        </h1>

        <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground">
          Every merchant, date, line item and total pulled out automatically,
          categorised, and filed. You glance at it once and confirm.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="glow-primary gap-2" asChild>
            <Link href="/signin">
              Start scanning
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/app">View the dashboard</Link>
          </Button>
        </div>

        <ReviewPreview />
      </div>
    </section>
  );
}

/**
 * Static mock of the review screen — the interaction the whole product is
 * built around. Showing it is the fastest way to explain what Nori does;
 * a feature list never lands the same way.
 */
function ReviewPreview() {
  return (
    <div
      id="how"
      className="surface-edge mt-16 overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-black/40"
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
        </div>
        <p className="ml-2 text-xs text-muted-foreground">
          Review · Tesco Express
        </p>
        <Badge
          variant="secondary"
          className="ml-auto gap-1 bg-warning/15 text-warning"
        >
          <TriangleAlert className="size-3" aria-hidden />
          Needs review
        </Badge>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Receipt pane */}
        <div className="relative flex items-center justify-center border-b bg-background/40 p-8 md:border-r md:border-b-0">
          <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
          <div className="relative w-full max-w-[15rem] rounded-lg bg-neutral-200 p-4 font-mono text-[0.6875rem] leading-relaxed text-neutral-800 shadow-xl">
            <p className="text-center font-semibold tracking-wide">
              TESCO EXPRESS
            </p>
            <p className="mb-3 text-center text-[0.625rem] text-neutral-500">
              24 JUL 2026 18:42
            </p>
            <Row label="Oat milk 1L" value="1.85" />
            <Row label="Sourdough loaf" value="2.40" />
            <Row label="Cheddar 200g" value="3.75" />
            <Row label="Tomatoes 400g" value="1.10" />
            <div className="my-2 border-t border-dashed border-neutral-400" />
            <Row label="SUBTOTAL" value="9.10" />
            <Row label="VAT" value="0.46" />
            {/* The highlighted field — the bbox-linking interaction from
                spec §8.5, shown here statically. The smudged decimal point is
                the single most common OCR failure on thermal paper, which is
                exactly what the reconciliation check in §7.4 exists to catch. */}
            <div className="relative -mx-1 mt-1 rounded px-1 ring-2 ring-primary">
              <Row label="TOTAL" value="9.56" bold />
              <span className="absolute -top-2 right-1 rounded-sm bg-primary px-1 text-[0.5rem] font-semibold text-primary-foreground">
                TOTAL
              </span>
            </div>
          </div>
        </div>

        {/* Extracted fields pane */}
        <div className="space-y-3 p-6">
          <Field label="Merchant" value="Tesco Express" confidence="high" />
          <Field label="Date" value="24 Jul 2026" confidence="high" />
          <Field label="Category" value="🛒  Groceries" confidence="high" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Subtotal" value="£9.10" confidence="high" numeric />
            <Field label="VAT" value="£0.46" confidence="medium" numeric />
          </div>

          <Field label="Total" value="£95.60" confidence="low" numeric active />

          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Subtotal plus VAT is £9.56, but the total reads £95.60 — the
            decimal point is likely misread.
          </p>

          <div className="flex gap-2 pt-2">
            <Button size="sm" className="glow-primary gap-1.5">
              <Check className="size-3.5" aria-hidden />
              Confirm
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              or press ⌘↵
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-bold" : ""}`}>
      <span className="truncate">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  confidence,
  numeric,
  active,
}: {
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  numeric?: boolean;
  active?: boolean;
}) {
  return (
    <div>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {confidence === "low" && (
          <TriangleAlert className="size-3 text-warning" aria-hidden />
        )}
        {/* Confidence must not be conveyed by colour alone — spec §8.2. */}
        <span className="sr-only">
          {confidence === "high"
            ? "high confidence"
            : "low confidence, please check"}
        </span>
      </span>
      <div
        className={[
          "rounded-md border bg-background/60 px-3 py-2 text-sm",
          numeric ? "numeric text-right" : "",
          confidence === "high" ? "field-confidence-high" : "",
          confidence === "medium" ? "field-confidence-medium" : "",
          confidence === "low" ? "field-confidence-low" : "",
          active ? "ring-[3px] ring-ring/50" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: ScanLine,
    title: "Reads the paper, not a template",
    body: "Images are rotated, contrast-normalised and run through Tesseract server-side, so a crumpled thermal receipt from a coat pocket still resolves.",
  },
  {
    icon: Sparkles,
    title: "Structured, never invented",
    body: "The model returns a strict schema where every field can be null. Arithmetic is re-checked in plain code afterwards, so a confident wrong total gets caught.",
  },
  {
    icon: Wallet,
    title: "Learns your merchants",
    body: "Correct a category once and Nori remembers it for that shop — the next receipt from there skips the model call entirely.",
  },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="text-2xl font-semibold tracking-tight">
        Built for receipts that have been through a pocket
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        The hard part is not reading a clean PDF. It is reading faded thermal
        paper at an angle — and knowing when it got it wrong.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="surface-edge rounded-xl border bg-card p-6"
          >
            <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Icon className="size-4.5" aria-hidden />
            </div>
            <h3 className="font-medium">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
