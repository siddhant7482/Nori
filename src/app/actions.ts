"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories, receipts, rules, settings, transactions } from "@/db/schema";
import { normalise } from "@/lib/filing";
import { gbp } from "@/lib/format";
import { getConnection } from "@/monzo/oauth";
import { refile, syncOnce } from "@/monzo/sync";

/* ============================================================
   Every change a person can make. Each returns a sentence for the
   toast, written from their side: what happened, in their words.
   ============================================================ */

type Result = { ok: boolean; message: string };

const done = (message: string): Result => {
  try {
    revalidatePath("/", "layout");
  } catch {
    /* outside a request (a script or a check), there is no cache to clear */
  }
  return { ok: true, message };
};

/** File a payment in a budget, and teach Nori the shop. Filing is the
 *  one thing a person does by hand, so it is never undone by a rule. */
export async function fileTransaction(txId: string, categoryId: string | null): Promise<Result> {
  const [t] = await db.select().from(transactions).where(eq(transactions.id, txId));
  if (!t) return { ok: false, message: "That payment isn't here any more. Reload and try again." };
  const label = t.merchantName ?? t.counterpartyName ?? t.description;
  if (!categoryId) {
    await db.update(transactions).set({ categoryId: null, filedBy: "you" }).where(eq(transactions.id, txId));
    return done(`Left ${label} unfiled. It won't count against any budget.`);
  }
  const [c] = await db.select().from(categories).where(eq(categories.id, categoryId));
  if (!c) return { ok: false, message: "That budget doesn't exist any more." };

  await db.update(transactions).set({ categoryId, filedBy: "you" }).where(eq(transactions.id, txId));

  /* One rule per shop: filing it again replaces the old one. */
  const key = t.merchantGroupId ? { merchantGroupId: t.merchantGroupId, pattern: null } : { merchantGroupId: null, pattern: normalise(t.description) };
  await db.delete(rules).where(key.merchantGroupId ? eq(rules.merchantGroupId, key.merchantGroupId) : and(isNull(rules.merchantGroupId), eq(rules.pattern, key.pattern!)));
  await db.insert(rules).values({ ...key, label, categoryId });

  const before = await db.select({ id: transactions.id, categoryId: transactions.categoryId }).from(transactions).where(key.merchantGroupId ? eq(transactions.merchantGroupId, key.merchantGroupId) : eq(transactions.description, t.description));
  await refile(before.map((r) => r.id));
  const after = await db.select({ id: transactions.id, categoryId: transactions.categoryId }).from(transactions).where(key.merchantGroupId ? eq(transactions.merchantGroupId, key.merchantGroupId) : eq(transactions.description, t.description));
  const moved = after.filter((r) => r.id !== txId && r.categoryId === categoryId && before.find((b) => b.id === r.id)?.categoryId !== categoryId).length;
  return done(`Filed ${label} as ${c.name}.${moved ? ` ${moved} other payment${moved === 1 ? "" : "s"} there moved with it.` : ""} Nori files it itself from now on.`);
}

export async function setBudget(categoryId: string, pounds: string): Promise<Result> {
  const v = parseFloat(pounds.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(v) || v < 0) return { ok: false, message: "That needs to be an amount in pounds, like 200." };
  const [c] = await db.update(categories).set({ limit: Math.round(v * 100) }).where(eq(categories.id, categoryId)).returning();
  if (!c) return { ok: false, message: "That budget doesn't exist any more." };
  return done(v ? `${c.name} budget set to £${v.toFixed(2)} a cycle. The daily number and the IOUs were worked out again from it.` : `${c.name} has no budget now, so it's out of the daily number.`);
}

export async function setVoice(voice: string): Promise<Result> {
  if (!["clean", "direct", "warden"].includes(voice)) return { ok: false, message: "Unknown voice." };
  await db.insert(settings).values({ id: 1, voice }).onConflictDoUpdate({ target: settings.id, set: { voice } });
  return done(`Voice set to ${voice}. Every message in Nori and on the hub uses it.`);
}

export async function setPaydayRule(rule: string): Promise<Result> {
  if (!/^(auto|calendar|lwd|dom:\d{1,2})$/.test(rule)) return { ok: false, message: "Unknown payday rule." };
  await db.insert(settings).values({ id: 1, paydayRule: rule }).onConflictDoUpdate({ target: settings.id, set: { paydayRule: rule } });
  return done(rule === "auto" ? "Payday follows your salary again." : rule === "calendar" ? "Cycles follow the calendar month now." : "Payday rule changed. The current cycle was worked out again.");
}

/** Name the credit that is your pay. Everything about cycles follows
 *  from it, so it is a person's call, not a guess. */
export async function setPayPayer(payer: string | null): Promise<Result> {
  const value = payer?.trim() || null;
  await db.insert(settings).values({ id: 1, payPayer: value }).onConflictDoUpdate({ target: settings.id, set: { payPayer: value } });
  return done(value ? `Pay comes from ${value}. Cycles run from one to the next.` : "Forgotten. Cycles follow the calendar month until you say otherwise.");
}

export async function deleteRule(id: number): Promise<Result> {
  const [r] = await db.delete(rules).where(eq(rules.id, id)).returning();
  if (!r) return { ok: false, message: "That rule is already gone." };
  await refile();
  return done(`Forgot the rule for ${r.label}. Its payments fall back to Monzo's category, or unfiled.`);
}

/** Say which payment a receipt belongs to, or take it off one. A
 *  person's answer is final: reading it again never moves it. */
export async function linkReceipt(receiptId: number, txId: string | null): Promise<Result> {
  const [r] = await db
    .update(receipts)
    .set({ txId, linkedBy: txId ? "you" : null, status: txId ? "matched" : "unmatched", detail: txId ? null : "You unlinked this one.", updatedAt: new Date() })
    .where(eq(receipts.id, receiptId))
    .returning();
  if (!r) return { ok: false, message: "That receipt is gone." };
  if (!txId) return done("Unlinked. It waits for the right payment.");
  const [t] = await db.select().from(transactions).where(eq(transactions.id, txId));
  return done(`Attached to ${t?.merchantName ?? t?.description ?? "the payment"}${t ? ` · ${gbp(-t.amount)}` : ""}.`);
}

/** Forgets the reading. The photograph stays in Vault, which is where
 *  files are deleted from. */
export async function forgetReceipt(receiptId: number): Promise<Result> {
  const [r] = await db.delete(receipts).where(eq(receipts.id, receiptId)).returning({ name: receipts.name });
  return r ? done(`Forgot ${r.name}. The photograph is still in Vault.`) : { ok: false, message: "That receipt is already gone." };
}

export async function syncNow(): Promise<Result> {
  const c = await getConnection();
  if (!c?.approvedAt) return { ok: false, message: "Monzo isn't connected and approved yet." };
  try {
    const r = await syncOnce("recent");
    if (r === "busy") return { ok: true, message: "A sync is already running. It'll show up in a moment." };
    return done(`Synced. Read ${r.fetched} transaction${r.fetched === 1 ? "" : "s"} from the last two weeks.`);
  } catch (e) {
    return { ok: false, message: "The sync failed: " + (e instanceof Error ? e.message : String(e)) };
  }
}
