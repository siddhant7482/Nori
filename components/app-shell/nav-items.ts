import {
  LayoutDashboard,
  Receipt,
  ChartLine,
  Tags,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the bottom bar, where a tab is ~70px wide. */
  shortLabel?: string;
  icon: LucideIcon;
  mobile: boolean;
};

/**
 * Exactly four `mobile` entries, so the bottom bar is a 5-column grid with
 * capture dead centre. Categories is desktop-only — it is a low-frequency
 * management screen and does not earn a permanent tab.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard, mobile: true },
  { href: "/app/receipts", label: "Receipts", icon: Receipt, mobile: true },
  { href: "/app/insights", label: "Insights", icon: ChartLine, mobile: true },
  { href: "/app/categories", label: "Categories", icon: Tags, mobile: false },
  { href: "/app/settings", label: "Settings", icon: Settings, mobile: true },
];

/** `/app` must match exactly or it lights up for every child route. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}
