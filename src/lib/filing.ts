/* ============================================================
   Which budget a payment belongs to.

   In order, first match wins:
     1. you filed it by hand          (never revisited)
     2. a rule you created by filing  (newest rule first)
     3. Monzo's own category, when a budget claims it
     4. nothing: UNFILED, and it shows up under "Needs you"

   A rule matches the merchant GROUP when Monzo has one, so filing
   one Pret files every Pret; otherwise the cleaned description.
   ============================================================ */

export type Kind = "spend" | "refund" | "income" | "pot" | "transfer" | "ignored";

export interface Fileable {
  kind: Kind;
  merchantGroupId: string | null;
  description: string;
  monzoCategory: string | null;
}

export interface RuleLike {
  id: number;
  merchantGroupId: string | null;
  pattern: string | null;
  categoryId: string;
}

export interface CatLike {
  id: string;
  monzo: string[];
}

/** "  Paypal *Steam   " -> "PAYPAL *STEAM". Digits are kept: they are
 *  often the only thing telling two payees apart. */
export function normalise(description: string): string {
  return description.toUpperCase().replace(/\s+/g, " ").trim();
}

export function categorise(t: Fileable, rules: RuleLike[], cats: CatLike[]): { categoryId: string | null; filedBy: "rule" | "monzo" | null } {
  if (t.kind !== "spend" && t.kind !== "refund") return { categoryId: null, filedBy: null };
  const desc = normalise(t.description);
  const newest = [...rules].sort((a, b) => b.id - a.id);
  for (const r of newest) {
    if (r.merchantGroupId && t.merchantGroupId === r.merchantGroupId) return { categoryId: r.categoryId, filedBy: "rule" };
    if (!r.merchantGroupId && r.pattern && (desc === r.pattern || desc.startsWith(r.pattern + " "))) return { categoryId: r.categoryId, filedBy: "rule" };
  }
  if (t.monzoCategory) {
    const c = cats.find((k) => k.monzo.includes(t.monzoCategory!));
    if (c) return { categoryId: c.id, filedBy: "monzo" };
  }
  return { categoryId: null, filedBy: null };
}

/** Monzo's category names, as a person reads them. */
export const MONZO_CATEGORIES: Record<string, string> = {
  general: "General",
  eating_out: "Eating out",
  expenses: "Expenses",
  transport: "Transport",
  cash: "Cash",
  bills: "Bills",
  entertainment: "Entertainment",
  shopping: "Shopping",
  holidays: "Holidays",
  groceries: "Groceries",
  personal_care: "Personal care",
  family: "Family",
  charity: "Charity",
  finances: "Finances",
  gifts: "Gifts",
  savings: "Savings",
  transfers: "Transfers",
  income: "Income",
};
