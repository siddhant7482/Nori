import { desc, gte } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell, type Payment, type Screen, type SyncInfo, type TickerItem } from "@/components/Shell";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { getPicture } from "@/lib/data";
import { gbp } from "@/lib/format";
import { short, withDay } from "@/lib/london";
import { affordInput } from "@/lib/month";
import { COOKIE, validSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/* The screens that exist. The dock only ever shows what is built, and
 * each keeps the number it will always have, so muscle memory learned
 * now still works when Spending (2) and Budgets (4) arrive. */
function screens(unfiled: number): Screen[] {
  return [
    { id: "home", k: "1", name: "Home", href: "/" },
    { id: "tx", k: "3", name: "Transactions", href: "/transactions", badge: unfiled || undefined },
    { id: "budgets", k: "4", name: "Budgets", href: "/budgets" },
    { id: "settings", k: "0", name: "Settings", href: "/settings" },
  ];
}

/* Everything behind the login. The proxy already turned away anyone
 * without a session; checking again here means a future matcher
 * mistake shows the login page rather than the bank account. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!validSession((await cookies()).get(COOKIE)?.value)) redirect("/login");
  const pic = await getPicture();
  const m = pic.month;

  const ticker: TickerItem[] = m.cats
    .filter((c) => !c.fixed)
    .map((c) => {
      const over = c.limit > 0 && c.spent > c.limit;
      return { label: c.name.toUpperCase(), value: gbp(c.spent), note: over ? `OVER +${gbp(c.spent - c.limit)}` : c.daily ? `${gbp(c.perDayLeft)}/DAY` : "NO BUDGET SET", tone: over ? "ov" : c.daily ? "ok" : undefined };
    });
  const fixed = m.cats.filter((c) => c.fixed);
  if (fixed.length) {
    const spent = fixed.reduce((n, c) => n + c.spent, 0), limit = fixed.reduce((n, c) => n + c.limit, 0);
    ticker.push({ label: "BILLS", value: gbp(spent), note: limit > spent ? `${gbp(limit - spent)} STILL DUE` : "ALL PAID" });
  }
  if (m.saved) ticker.push({ label: "POTS", value: "+" + gbp(m.saved), note: "THIS CYCLE", tone: "ok" });
  ticker.push({ label: "DAILY", value: gbp(m.leftADay), note: `FOR ${m.cycle.daysLeft} DAYS` });
  ticker.push({ label: "PAYDAY", value: withDay(m.cycle.nextPayday).toUpperCase(), note: `${m.daysToPayday} DAYS` });
  if (m.unfiled.length) ticker.push({ label: "UNFILED", value: String(m.unfiled.length), note: "NEEDS YOU", tone: "ov" });

  const sync: SyncInfo = {
    state: pic.conn.example ? "example" : !pic.conn.connected ? "off" : !pic.conn.approved ? "waiting" : pic.conn.lastError ? "error" : "live",
    lastSyncAt: pic.conn.lastSyncAt?.toISOString() ?? null,
    detail: pic.conn.lastError,
  };

  /* The palette finds payments from the current cycle and the one
   * before; older ones are a Transactions search away. */
  const recent = await db
    .select({ id: transactions.id, description: transactions.description, merchantName: transactions.merchantName, counterpartyName: transactions.counterpartyName, amount: transactions.amount, day: transactions.day })
    .from(transactions)
    .where(gte(transactions.day, m.cycle.start))
    .orderBy(desc(transactions.created))
    .limit(400);
  const payments: Payment[] = recent.map((t) => {
    const label = t.merchantName ?? t.counterpartyName ?? t.description;
    return { id: t.id, label, hint: `${short(t.day)} · ${gbp(Math.abs(t.amount))}`, search: `${label} ${t.description}`.toLowerCase() };
  });

  return (
    <Shell screens={screens(m.unfiled.length)} ticker={ticker} sync={sync} afford={affordInput(m)} voice={pic.voice} payments={payments} unfiled={{ count: m.unfiled.length, total: m.unfiledTotal }}>
      {children}
    </Shell>
  );
}
