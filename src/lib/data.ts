import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { accounts, categories, connection, pots, rules, settings, syncRuns, transactions } from "@/db/schema";
import { addDays, today as londonToday, type Day } from "./london";
import { computeMonth, type Month, type TxIn } from "./month";
import { doubleCharges, findRecurring, stillDue, type DoubleCharge, type Due, type Series } from "./recurring";
import { cycleFor, detectPayday, payCandidates, pastCycles, type Candidate, type Payday } from "./payday";

/* ============================================================
   Reads, shaped for screens. Every figure goes through computeMonth
   so Home, the dock, the hub and the afford answer cannot disagree.
   ============================================================ */

/** The budgets a fresh Nori starts with. Limits start at 0 ("not set")
 *  and Settings offers what you actually spent over the last three
 *  cycles, so the first number is yours rather than a guess of mine.
 *  Stack order and colours are the ones that passed the colour-blind
 *  check: green and coral never touch. */
export const DEFAULT_CATEGORIES = [
  { id: "groc", name: "Groceries", hex: "#0e7a45", fixed: false, position: 0, monzo: ["groceries"] },
  { id: "shop", name: "Shopping", hex: "#4a3aa7", fixed: false, position: 1, monzo: ["shopping", "personal_care"] },
  { id: "eat", name: "Eating out", hex: "#e0603f", fixed: false, position: 2, monzo: ["eating_out"] },
  { id: "trans", name: "Transport", hex: "#2a78d6", fixed: false, position: 3, monzo: ["transport"] },
  { id: "bills", name: "Bills", hex: "#5d6d74", fixed: true, position: 4, monzo: ["bills"] },
];

export async function ensureDefaults() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(categories);
  if (!n) await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, limit: 0 }))).onConflictDoNothing();
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
}

const toTxIn = (t: typeof transactions.$inferSelect): TxIn => ({
  id: t.id,
  day: t.day,
  amount: t.amount,
  kind: t.kind,
  categoryId: t.categoryId,
  description: t.description,
  merchantName: t.merchantName,
  counterpartyName: t.counterpartyName,
  potId: t.potId,
});

export interface Picture {
  month: Month;
  /** Who pays you, for you to say which one is the pay. */
  candidates: Candidate[];
  /** Every recurring payment Nori has found, soonest due first. */
  series: Series[];
  doubles: DoubleCharge[];
  pay: Payday | null;
  voice: "clean" | "direct" | "warden";
  paydayRule: string;
  conn: {
    connected: boolean;
    approved: boolean;
    example: boolean;
    lastSyncAt: Date | null;
    lastError: string | null;
    fullHistory: boolean;
    historyFrom: Date | null;
  };
}

/** Everything Home and the frame need, once per request. */
export const getPicture = cache(async (): Promise<Picture> => {
  await ensureDefaults();
  const day = londonToday();
  const [cats, [set], [conn], credits, [acct]] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.position)),
    db.select().from(settings).where(eq(settings.id, 1)),
    db.select().from(connection).where(eq(connection.id, 1)),
    db
      .select({ day: transactions.day, amount: transactions.amount, payer: sql<string>`coalesce(${transactions.counterpartyName}, ${transactions.description})` })
      .from(transactions)
      .where(and(eq(transactions.kind, "income"), gte(transactions.day, addDays(day, -400)))),
    db.select({ description: accounts.description }).from(accounts).where(eq(accounts.closed, false)).limit(1),
  ]);
  /* Monzo names a personal account after its holder, which is how Nori
   * knows a credit from "you" is a transfer rather than a payday. */
  const pay = detectPayday(credits, day, acct?.description ?? null, set?.payPayer ?? null);
  const candidates = payCandidates(credits, acct?.description ?? null);
  const cycle = cycleFor(day, pay, set?.paydayRule ?? "auto");
  /* A year and a bit, because three occurrences is the floor for
   * calling something recurring and a yearly bill needs the room. */
  const history = await db
    .select()
    .from(transactions)
    .where(and(gte(transactions.day, addDays(day, -400)), lte(transactions.day, day)));
  const series = findRecurring(history, day);
  const rows = history.filter((t) => t.day >= cycle.start);
  const due: Due[] = stillDue(series, day, cycle.end);
  const month = computeMonth({ cats, txs: rows.map(toTxIn), cycle, today: day, due });
  const [{ n: txCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);
  return {
    month,
    candidates,
    series,
    doubles: doubleCharges(history, cycle.start),
    pay,
    voice: (set?.voice as Picture["voice"]) ?? "direct",
    paydayRule: set?.paydayRule ?? "auto",
    conn: {
      connected: Boolean(conn),
      approved: Boolean(conn?.approvedAt),
      example: !conn && txCount > 0,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastError: conn?.lastError ?? null,
      fullHistory: conn?.fullHistory ?? false,
      historyFrom: conn?.historyFrom ?? null,
    },
  };
});

export type Row = typeof transactions.$inferSelect;

/** One cycle's transactions, newest first. offset 0 is the current one. */
export async function cycleTransactions(offset: number): Promise<{ start: Day; end: Day; rows: Row[]; hasEarlier: boolean }> {
  const { month, pay } = await getPicture();
  const past = pastCycles(pay, month.cycle, Math.max(offset, 1) + 1);
  const range = offset === 0 ? { start: month.cycle.start, end: month.today } : past[offset - 1];
  if (!range) return { start: month.cycle.start, end: month.today, rows: [], hasEarlier: false };
  const rows = await db
    .select()
    .from(transactions)
    .where(and(gte(transactions.day, range.start), lte(transactions.day, range.end)))
    .orderBy(desc(transactions.created));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions).where(sql`${transactions.day} < ${range.start}`);
  return { ...range, rows, hasEarlier: n > 0 };
}

export async function allCategories() {
  return db.select().from(categories).orderBy(asc(categories.position));
}

export async function allRules() {
  return db.select().from(rules).orderBy(desc(rules.id));
}

export async function allPots() {
  return db.select().from(pots).where(eq(pots.deleted, false)).orderBy(desc(pots.balance));
}

export async function lastRuns(n = 5) {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(n);
}

/** What each budget actually took over the last three full cycles:
 *  the suggestion Settings offers in place of a guessed limit. */
export async function suggestedLimits(): Promise<Record<string, number>> {
  const { month, pay } = await getPicture();
  const past = pastCycles(pay, month.cycle, 3);
  if (!past.length) return {};
  const from = past[past.length - 1].start, to = past[0].end;
  const rows = await db
    .select({ categoryId: transactions.categoryId, total: sql<number>`(-sum(${transactions.amount}))::bigint` })
    .from(transactions)
    .where(and(gte(transactions.day, from), lte(transactions.day, to), inArray(transactions.kind, ["spend", "refund"])))
    .groupBy(transactions.categoryId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.categoryId) out[r.categoryId] = Math.ceil(Number(r.total) / past.length / 1000) * 1000;
  return out;
}
