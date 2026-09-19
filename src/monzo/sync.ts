import { and, eq, inArray, isNull, max, min, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, connection, pots, rules, syncRuns, transactions } from "@/db/schema";
import { categorise, type Kind } from "@/lib/filing";
import { dayOf } from "@/lib/london";
import { monzo, MonzoError, PAGE, type MonzoTransaction } from "./client";
import { accessToken, getConnection, releaseLease, takeLease } from "./oauth";

/* ============================================================
   Sync: Monzo's feed into Nori's tables.

   `full` runs once, straight after you approve Nori in the Monzo app,
   and walks every transaction since the account opened. It is racing
   a clock: Monzo only serves history older than 90 days for about
   five minutes after authentication. If the window closes part way,
   the sync says so, keeps what it got, and takes the last 90 days.

   `recent` is the five-minute timer. It re-reads the last fourteen
   days every time, because a pending card payment can change amount
   when it settles, and upserts by Monzo's id so nothing duplicates.
   ============================================================ */

export type SyncMode = "full" | "recent";

export interface SyncResult {
  mode: SyncMode;
  fetched: number;
  fullHistory: boolean | null;
  historyFrom: Date | null;
}

const RETAIL = new Set(["uk_retail", "uk_retail_joint"]);
const RECENT_DAYS = 14;
const WINDOW_DAYS = 89;

/** What a transaction IS. Pot moves and transfers between your own
 *  accounts are never spending; the Monzo docs do not describe how pot
 *  moves appear, so every signal seen in the wild is checked. */
export function classify(t: MonzoTransaction, ownUserId: string | null): Kind {
  if (t.decline_reason || t.amount === 0) return "ignored";
  if (t.metadata?.pot_id || t.scheme === "uk_retail_pot" || /^pot_[0-9A-Za-z]+$/.test(t.description)) return "pot";
  if (t.is_load) return "transfer";
  if (ownUserId && t.counterparty?.user_id && t.counterparty.user_id === ownUserId) return "transfer";
  if (t.amount < 0) return "spend";
  return t.merchant ? "refund" : "income";
}

function toRow(t: MonzoTransaction, ownUserId: string | null) {
  const merchant = t.merchant && typeof t.merchant === "object" ? t.merchant : null;
  const created = new Date(t.created);
  return {
    id: t.id,
    accountId: t.account_id,
    created,
    settled: t.settled ? new Date(t.settled) : null,
    day: dayOf(created),
    amount: t.amount,
    currency: t.currency,
    localAmount: t.local_amount ?? null,
    localCurrency: t.local_currency ?? null,
    description: t.description,
    merchantId: merchant?.id ?? (typeof t.merchant === "string" ? t.merchant : null),
    merchantGroupId: merchant?.group_id ?? null,
    merchantName: merchant?.name ?? null,
    counterpartyName: t.counterparty?.name ?? null,
    monzoCategory: t.category ?? null,
    kind: classify(t, ownUserId),
    potId: t.metadata?.pot_id ?? null,
    notes: t.notes || null,
    raw: t,
    updatedAt: new Date(),
  };
}

async function upsert(rows: ReturnType<typeof toRow>[]) {
  if (!rows.length) return;
  const set = Object.fromEntries(
    ["accountId", "created", "settled", "day", "amount", "currency", "localAmount", "localCurrency", "description", "merchantId", "merchantGroupId", "merchantName", "counterpartyName", "monzoCategory", "kind", "potId", "notes", "raw", "updatedAt"].map((k) => [k, sql.raw(`excluded.${toSnake(k)}`)]),
  );
  await db.insert(transactions).values(rows).onConflictDoUpdate({ target: transactions.id, set });
}

function toSnake(k: string) {
  return k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

/** Re-files every row a person has not filed by hand. Grouped updates,
 *  so a full history of thousands of rows is a handful of queries. */
export async function refile(ids?: string[]) {
  const [ruleRows, catRows] = await Promise.all([db.select().from(rules), db.select().from(categories)]);
  const notYours = or(isNull(transactions.filedBy), ne(transactions.filedBy, "you"));
  const rows = await db
    .select({ id: transactions.id, kind: transactions.kind, merchantGroupId: transactions.merchantGroupId, description: transactions.description, monzoCategory: transactions.monzoCategory, categoryId: transactions.categoryId, filedBy: transactions.filedBy })
    .from(transactions)
    .where(ids ? and(inArray(transactions.id, ids), notYours) : notYours);
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const f = categorise(r, ruleRows, catRows);
    if (f.categoryId === r.categoryId && f.filedBy === r.filedBy) continue;
    const k = JSON.stringify(f);
    groups.set(k, [...(groups.get(k) ?? []), r.id]);
  }
  for (const [k, list] of groups) {
    const f = JSON.parse(k) as { categoryId: string | null; filedBy: "rule" | "monzo" | null };
    for (let i = 0; i < list.length; i += 1000) {
      await db.update(transactions).set(f).where(inArray(transactions.id, list.slice(i, i + 1000)));
    }
  }
}

async function pull(token: string, accountId: string, since: string, ownUserId: string | null): Promise<{ count: number; ids: string[] }> {
  let cursor = since, count = 0;
  const ids: string[] = [];
  for (;;) {
    const page = await monzo.transactions(token, accountId, cursor);
    const rows = page.map((t) => toRow(t, ownUserId));
    await upsert(rows);
    count += rows.length;
    ids.push(...rows.map((r) => r.id));
    if (page.length < PAGE) return { count, ids };
    cursor = page[page.length - 1].id;
  }
}

export async function runSync(mode: SyncMode): Promise<SyncResult> {
  const conn = await getConnection();
  if (!conn) throw new Error("Monzo is not connected.");
  const [run] = await db.insert(syncRuns).values({ mode }).returning({ id: syncRuns.id });
  let fetched = 0, fullHistory: boolean | null = null;
  try {
    const token = await accessToken();
    const who = await monzo.whoami(token);
    const all = (await monzo.accounts(token)).filter((a) => RETAIL.has(a.type));
    for (const a of all) {
      const row = { id: a.id, type: a.type, description: a.description, createdAt: new Date(a.created), closed: a.closed };
      await db.insert(accounts).values(row).onConflictDoUpdate({ target: accounts.id, set: row });
    }
    const touched: string[] = [];
    for (const a of all) {
      if (!a.closed) {
        const b = await monzo.balance(token, a.id);
        await db.update(accounts).set({ balance: b.balance, balanceAt: new Date() }).where(eq(accounts.id, a.id));
        for (const p of await monzo.pots(token, a.id)) {
          const row = { id: p.id, accountId: a.id, name: p.name, balance: p.balance, goal: p.goal_amount ?? null, deleted: p.deleted, updatedAt: new Date(p.updated) };
          await db.insert(pots).values(row).onConflictDoUpdate({ target: pots.id, set: row });
        }
      }
      const ninety = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      let since: string;
      if (mode === "full") since = new Date(a.created).toISOString();
      else {
        const [{ latest }] = await db.select({ latest: max(transactions.created) }).from(transactions).where(eq(transactions.accountId, a.id));
        since = latest ? new Date(latest.getTime() - RECENT_DAYS * 86_400_000).toISOString() : ninety;
      }
      try {
        const r = await pull(token, a.id, since, who.user_id);
        fetched += r.count;
        touched.push(...r.ids);
        if (mode === "full" && fullHistory === null) fullHistory = true;
      } catch (e) {
        /* The history window closed under us. Keep what arrived, say so,
         * and take the 90 days Monzo still allows. */
        if (!(e instanceof MonzoError && e.forbidden) || mode !== "full") throw e;
        fullHistory = false;
        const r = await pull(token, a.id, ninety, who.user_id);
        fetched += r.count;
        touched.push(...r.ids);
      }
    }
    await refile(mode === "full" ? undefined : touched);
    const [{ from }] = await db.select({ from: min(transactions.created) }).from(transactions);
    await db
      .update(connection)
      .set({
        monzoUserId: who.user_id,
        lastSyncAt: new Date(),
        lastError: null,
        historyFrom: from,
        ...(mode === "full" ? { fullHistory: Boolean(fullHistory), approvedAt: conn.approvedAt ?? new Date() } : {}),
      })
      .where(eq(connection.id, 1));
    await db.update(syncRuns).set({ finishedAt: new Date(), ok: true, fetched }).where(eq(syncRuns.id, run.id));
    return { mode, fetched, fullHistory, historyFrom: from };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await db.update(connection).set({ lastError: detail.slice(0, 300) }).where(eq(connection.id, 1));
    await db.update(syncRuns).set({ finishedAt: new Date(), ok: false, fetched, detail: detail.slice(0, 500) }).where(eq(syncRuns.id, run.id));
    throw e;
  }
}

/** Runs a sync under the lease, or reports that one is already going. */
export async function syncOnce(mode: SyncMode, leaseMinutes = mode === "full" ? 15 : 4): Promise<SyncResult | "busy"> {
  if (!(await takeLease(leaseMinutes))) return "busy";
  try {
    return await runSync(mode);
  } finally {
    await releaseLease();
  }
}
