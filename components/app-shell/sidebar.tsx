"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { Logo } from "@/components/nori/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";

export function Sidebar({
  reviewCount = 0,
  userMenu,
}: {
  reviewCount?: number;
  /** Rendered from the server layout so the session never reaches the client. */
  userMenu?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link
          href="/app"
          className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
      </div>

      <div className="px-3 pb-4">
        <Button className="glow-primary w-full justify-start gap-2" asChild>
          <Link href="/app/capture">
            <Plus className="size-4" aria-hidden />
            Add receipt
          </Link>
        </Button>
      </div>

      <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              {/* Accent rail rather than a filled pill — at 240px wide a solid
                  block for every visited item makes the column feel noisy. */}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 -left-3 w-0.5 rounded-r-full bg-primary"
                />
              )}
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
              {href === "/app/receipts" && reviewCount > 0 && (
                <Badge
                  variant="secondary"
                  className="numeric ml-auto bg-warning/15 px-1.5 text-warning"
                >
                  {reviewCount}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-2">{userMenu}</div>
    </aside>
  );
}
