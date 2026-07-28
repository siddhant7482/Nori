"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";

/**
 * Bottom tab bar. Capture sits raised in the centre because it is the only
 * action a user performs frequently — everything else is looking things up.
 */
export function MobileNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.mobile);
  // Split evenly so capture lands in the middle column of five.
  const mid = Math.floor(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="grid h-16 grid-cols-5 items-center">
        {left.map((item) => (
          <Tab key={item.href} item={item} pathname={pathname} />
        ))}

        <Link
          href="/app/capture"
          aria-label="Add receipt"
          className="flex flex-col items-center justify-center"
        >
          <span className="glow-primary -mt-6 flex size-13 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
            <Camera className="size-5.5" aria-hidden />
          </span>
          <span className="mt-1 text-[0.625rem] font-medium">Capture</span>
        </Link>

        {right.map((item) => (
          <Tab key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  item,
  pathname,
}: {
  item: (typeof NAV_ITEMS)[number];
  pathname: string;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center gap-1 py-2 text-[0.625rem] transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {item.shortLabel ?? item.label}
    </Link>
  );
}
