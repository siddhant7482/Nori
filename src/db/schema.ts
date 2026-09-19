import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/* ============================================================
   Nori's schema.

   Monzo is the record. Every transaction row is a copy of one Monzo
   transaction, keyed by Monzo's own id, and a sync can rewrite
   everything Monzo owns (amount, settlement, merchant) at any time.
   What Nori adds on top — the budget a payment belongs to, and who
   decided that — is the only thing a sync must never clobber when a
   person made the call.

   Money is integer pence throughout, signed the way Monzo signs it:
   negative leaves the account, positive arrives.
   ============================================================ */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const pence = (name: string) => bigint(name, { mode: "number" });

/** What a transaction IS, decided once at sync time. Only `spend` and
 *  `refund` ever touch a budget: salary, pot moves and moving money
 *  between your own accounts are money moving, not money going. */
export const txKind = pgEnum("tx_kind", ["spend", "refund", "income", "pot", "transfer", "ignored"]);

/** Who put a transaction in its budget. `you` is final: no rule and no
 *  sync ever moves it again. `rule` and `monzo` are re-evaluated. */
export const filedBy = pgEnum("filed_by", ["you", "rule", "monzo"]);

/** The one Monzo connection. A singleton row, id always 1. */
export const connection = pgTable("connection", {
  id: integer("id").primaryKey().default(1),
  monzoUserId: text("monzo_user_id"),
  /** Both tokens are AES-GCM encrypted (src/lib/crypto.ts). */
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: ts("expires_at").notNull(),
  /** When the authorisation code came back. Monzo's full-history window
   *  is measured from about here, so the first sync races this clock. */
  authorisedAt: ts("authorised_at").notNull(),
  /** First successful read, i.e. when the owner approved Nori in the
   *  Monzo app. Before that the token holds no permissions at all. */
  approvedAt: ts("approved_at"),
  /** Did the first sync reach the start of the account, or only the
   *  last 90 days? Shown in Settings; it never silently changes. */
  fullHistory: boolean("full_history").notNull().default(false),
  historyFrom: ts("history_from"),
  lastSyncAt: ts("last_sync_at"),
  lastError: text("last_error"),
  /** A lease rather than an advisory lock: session locks do not survive
   *  a pooled connection, and a lease expires on its own if a sync dies. */
  syncLeaseUntil: ts("sync_lease_until"),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  createdAt: ts("created_at").notNull(),
  closed: boolean("closed").notNull().default(false),
  balance: pence("balance"),
  balanceAt: ts("balance_at"),
});

export const pots = pgTable("pots", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  balance: pence("balance").notNull(),
  goal: pence("goal"),
  deleted: boolean("deleted").notNull().default(false),
  updatedAt: ts("updated_at").notNull(),
});

/** Budgets. `limit` is per payday cycle, in pence; 0 means not set yet. */
export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hex: text("hex").notNull(),
  limit: pence("limit").notNull().default(0),
  /** Rent-like: known in advance, nothing to decide, not in the daily number. */
  fixed: boolean("fixed").notNull().default(false),
  position: integer("position").notNull().default(0),
  /** Monzo's own categories that land here unless a rule says otherwise. */
  monzo: text("monzo").array().notNull().default(sql`'{}'::text[]`),
});

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    created: ts("created").notNull(),
    settled: ts("settled"),
    /** The London calendar day it happened on. Stored, not derived in
     *  SQL, so cycles and day-by-day charts never redo time zones. */
    day: date("day", { mode: "string" }).notNull(),
    amount: pence("amount").notNull(),
    currency: text("currency").notNull(),
    localAmount: pence("local_amount"),
    localCurrency: text("local_currency"),
    description: text("description").notNull(),
    merchantId: text("merchant_id"),
    merchantGroupId: text("merchant_group_id"),
    merchantName: text("merchant_name"),
    counterpartyName: text("counterparty_name"),
    monzoCategory: text("monzo_category"),
    kind: txKind("kind").notNull(),
    potId: text("pot_id"),
    /** Null on a spend or refund means UNFILED. */
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    filedBy: filedBy("filed_by"),
    notes: text("notes"),
    raw: jsonb("raw").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("transactions_day").on(t.day), index("transactions_merchant_group").on(t.merchantGroupId)],
);

/** Written when you file a payment by hand. Matches the merchant group
 *  when Monzo knows one (every Pret, not just one branch), otherwise the
 *  cleaned-up description. */
export const rules = pgTable("rules", {
  id: serial("id").primaryKey(),
  merchantGroupId: text("merchant_group_id"),
  pattern: text("pattern"),
  label: text("label").notNull(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  voice: text("voice").notNull().default("direct"),
  /** "auto" follows the salary; anything else is a person overriding it. */
  paydayRule: text("payday_rule").notNull().default("auto"),
  /** The payer you named as your pay. Beats anything detection thinks:
   *  a transfer from your own salary account looks like any other
   *  transfer from the outside. */
  payPayer: text("pay_payer"),
});

/** A photograph of a receipt, and what Nori read off it. The image
 *  itself lives in Vault; this is the link and the figures. */
export const receiptStatus = pgEnum("receipt_status", ["reading", "matched", "unmatched", "failed"]);

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  /** Where the photograph is in Vault. */
  vaultId: integer("vault_id").notNull(),
  vaultKey: text("vault_key").notNull(),
  name: text("name").notNull(),
  bytes: integer("bytes").notNull(),
  status: receiptStatus("status").notNull().default("reading"),
  /** The payment it belongs to, once it is known. */
  txId: text("tx_id").references(() => transactions.id, { onDelete: "set null" }),
  /** "you" or "figures": who decided which payment this is. */
  linkedBy: text("linked_by"),
  merchant: text("merchant"),
  total: pence("total"),
  currency: text("currency"),
  purchasedAt: date("purchased_at", { mode: "string" }),
  cardLast4: text("card_last4"),
  items: jsonb("items").$type<{ name: string; total: number; quantity?: number | null }[]>(),
  /** What the arithmetic check disagreed with. */
  warnings: jsonb("warnings").$type<string[]>(),
  /** Read on the node, or sent to the model. */
  path: text("path"),
  ocrConfidence: integer("ocr_confidence"),
  detail: text("detail"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  ok: boolean("ok"),
  fetched: integer("fetched").notNull().default(0),
  detail: text("detail"),
});

export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
