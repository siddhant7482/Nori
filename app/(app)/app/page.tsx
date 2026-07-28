import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { MetricTile } from "@/components/nori/metric-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Dashboard" };

/*
 * TODO(phase 6): replace with real aggregates scoped to the session's
 * workspace via lib/db/scope.ts. Amounts are minor units throughout —
 * they only become strings at the render boundary, never before.
 */
const CURRENCY = "GBP";
const MOCK = {
  monthTotal: 128_443,
  monthDelta: 8.4,
  dailyAverage: 4_143,
  dailyDelta: -2.1,
  receiptCount: 47,
  needsReview: 3,
  categories: [
    { name: "Groceries", amount: 41_250, chart: "1" },
    { name: "Transport", amount: 28_900, chart: "2" },
    { name: "Restaurants & Cafés", amount: 21_430, chart: "3" },
    { name: "Subscriptions", amount: 18_600, chart: "4" },
    { name: "Health & Pharmacy", amount: 11_263, chart: "5" },
    { name: "Other", amount: 7_000, chart: "6" },
  ],
  recent: [
    { id: "1", merchant: "Tesco Express", category: "Groceries", amount: 4_290, date: "24 Jul", review: true },
    { id: "2", merchant: "Trainline", category: "Transport", amount: 32_400, date: "24 Jul", review: false },
    { id: "3", merchant: "Pret A Manger", category: "Restaurants & Cafés", amount: 875, date: "23 Jul", review: false },
    { id: "4", merchant: "Boots", category: "Health & Pharmacy", amount: 1_849, date: "23 Jul", review: true },
    { id: "5", merchant: "Spotify", category: "Subscriptions", amount: 1_199, date: "22 Jul", review: false },
  ],
};

export default function DashboardPage() {
  const maxCategory = Math.max(...MOCK.categories.map((c) => c.amount));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">July 2026</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {MOCK.receiptCount} receipts captured this month
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/app/receipts">
            All receipts
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>

      {MOCK.needsReview > 0 && <ReviewBanner count={MOCK.needsReview} />}

      {/* One hero number, then a compact strip of three. Four equally-sized
          tiles stacked on a phone buries the figure that actually matters;
          `xl:contents` dissolves the wrapper so all four line up on desktop. */}
      <div className="grid gap-4 xl:grid-cols-4">
        <MetricTile
          label="Spent this month"
          value={formatMoney(MOCK.monthTotal, CURRENCY)}
          delta={MOCK.monthDelta}
          invertDelta
          hint="vs June"
        />

        <div className="grid grid-cols-3 gap-3 sm:gap-4 xl:contents">
          <MetricTile
            compact
            label="Daily average"
            value={formatMoney(MOCK.dailyAverage, CURRENCY)}
            delta={MOCK.dailyDelta}
            invertDelta
          />
          <MetricTile
            compact
            label="Receipts"
            value={String(MOCK.receiptCount)}
            hint="this month"
          />
          <MetricTile
            compact
            label="To review"
            value={String(MOCK.needsReview)}
            hint="pending"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Horizontal bars, not a donut. Category spend is a magnitude
            comparison, and bars are read accurately where arc angles are not. */}
        <section className="surface-edge rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Where it went</h2>
          <ul className="mt-5 space-y-3.5">
            {MOCK.categories.map((c) => (
              <li key={c.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{c.name}</span>
                  <span className="numeric shrink-0 text-muted-foreground">
                    {formatMoney(c.amount, CURRENCY)}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${c.name}: ${formatMoney(c.amount, CURRENCY)}`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(c.amount / maxCategory) * 100}%`,
                      backgroundColor: `var(--chart-${c.chart})`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-edge rounded-xl border bg-card">
          <h2 className="border-b p-5 pb-4 text-sm font-medium">
            Recent receipts
          </h2>
          <ul className="divide-y">
            {MOCK.recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/app/receipts/${r.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.merchant}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.category} · {r.date}
                    </p>
                  </div>
                  {r.review && (
                    <Badge
                      variant="secondary"
                      className="bg-warning/15 text-warning"
                    >
                      Review
                    </Badge>
                  )}
                  <span className="numeric text-sm">
                    {formatMoney(r.amount, CURRENCY)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function ReviewBanner({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 p-4">
      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="flex-1 text-sm">
        <span className="font-medium">
          {count} {count === 1 ? "receipt needs" : "receipts need"} a quick look
        </span>{" "}
        <span className="text-muted-foreground">
          before they are added to your totals.
        </span>
      </p>
      <Button size="sm" variant="outline" asChild>
        <Link href="/app/receipts?status=NEEDS_REVIEW">Review now</Link>
      </Button>
    </div>
  );
}
