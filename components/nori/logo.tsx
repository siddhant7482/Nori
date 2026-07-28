import { cn } from "@/lib/utils";

/**
 * The mark is a receipt with a torn bottom edge. Literal on purpose — a
 * product this specific gains nothing from an abstract glyph, and the torn
 * edge is recognisable at 16px where finer detail would mud together.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-8", className)}
    >
      <path
        d="M6 5.5A2.5 2.5 0 0 1 8.5 3h15A2.5 2.5 0 0 1 26 5.5v20.9c0 .9-1 1.4-1.8.9l-2.4-1.6a1 1 0 0 0-1.1 0l-2.6 1.7a1 1 0 0 1-1.1 0l-2.6-1.7a1 1 0 0 0-1.1 0l-2.6 1.7a1 1 0 0 1-1.1 0l-2.4-1.6c-.8-.5-1.2-1-1.2-1.9V5.5Z"
        className="fill-primary"
      />
      <path
        d="M11 11h10M11 15.5h10M11 20h5.5"
        stroke="currentColor"
        className="text-background"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {showWordmark && (
        <span className="text-[1.0625rem] font-semibold tracking-tight">
          Nori
        </span>
      )}
      <span className="sr-only">Nori</span>
    </span>
  );
}
