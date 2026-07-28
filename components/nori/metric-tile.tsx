import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  /** Pre-formatted through lib/money.ts — never a raw number. */
  value: string;
  /** Percentage change vs the comparison period. */
  delta?: number;
  /** Set when a *rise* is bad news, e.g. spend. Flips the colour, not the arrow. */
  invertDelta?: boolean;
  hint?: string;
  /** Denser variant for the secondary stat strip on narrow screens. */
  compact?: boolean;
  className?: string;
};

export function MetricTile({
  label,
  value,
  delta,
  invertDelta = false,
  hint,
  compact = false,
  className,
}: Props) {
  const flat = delta === undefined || Math.abs(delta) < 0.05;
  const rising = (delta ?? 0) > 0;
  // The arrow always reflects direction; only the colour carries judgement.
  // Conflating the two is how a dashboard ends up showing "spending down"
  // in red and confusing everyone who glances at it.
  const good = invertDelta ? !rising : rising;

  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;

  return (
    <div
      className={cn(
        "surface-edge overflow-hidden rounded-xl border bg-card",
        compact ? "p-3.5 xl:p-5" : "p-5",
        className,
      )}
    >
      <p
        className={cn(
          "font-medium text-muted-foreground",
          compact ? "text-xs xl:text-[0.8125rem]" : "text-[0.8125rem]",
        )}
      >
        {label}
      </p>

      <p
        data-slot="metric"
        className={cn(
          "numeric mt-2.5 leading-none font-semibold",
          compact ? "text-xl xl:text-[1.75rem]" : "text-[1.75rem]",
        )}
      >
        {value}
      </p>

      <div
        className={cn(
          "flex items-center gap-2 text-xs",
          compact ? "mt-2 xl:mt-3" : "mt-3",
        )}
      >
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
              flat && "bg-muted text-muted-foreground",
              !flat && good && "bg-positive/12 text-positive",
              !flat && !good && "bg-warning/12 text-warning",
            )}
          >
            <Icon className="size-3" aria-hidden />
            <span className="numeric">{Math.abs(delta).toFixed(1)}%</span>
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
