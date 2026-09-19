import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { receipts, transactions } from "@/db/schema";
import { addDays, dayOf, today as londonToday, type Day } from "@/lib/london";
import { matchReceipt, type Candidate } from "@/lib/match";
import { analyzeReceipt } from "./pipeline/analyze";
import { getReceipt } from "./vault";

/* ============================================================
   From photograph to a payment with line items.

   Reading happens in three steps, and each one is allowed to fail
   without losing the others:

     1. Tesseract reads the image on the node.
     2. If that text is good enough it goes to the model as text;
        if it is not, the image itself does, unless you have turned
        that off. Either way the model only ever extracts: it is
        never asked to add anything up.
     3. Plain arithmetic checks what came back — items against the
        subtotal, subtotal and tax against the total — and whatever
        disagrees is kept as a warning rather than quietly fixed.

   Then the receipt is matched to a payment in the feed. Nothing is
   invented: a receipt Nori cannot place stays unmatched and waits
   for you, which is the honest outcome and a visible one.
   ============================================================ */

export interface ReadResult {
  status: "matched" | "unmatched" | "failed";
  detail?: string;
}

/** Payments worth comparing a receipt against: spending either side
 *  of the day it was written, which is where a card payment lands. */
async function candidates(on: Day): Promise<Candidate[]> {
  const rows = await db
    .select({ id: transactions.id, day: transactions.day, amount: transactions.amount, merchantName: transactions.merchantName, description: transactions.description })
    .from(transactions)
    .where(and(gte(transactions.day, addDays(on, -14)), lte(transactions.day, addDays(on, 14)), inArray(transactions.kind, ["spend"])));
  return rows;
}

export async function readReceipt(id: number): Promise<ReadResult> {
  const [row] = await db.select().from(receipts).where(eq(receipts.id, id));
  if (!row) return { status: "failed", detail: "That receipt is not here any more." };

  const fail = async (detail: string): Promise<ReadResult> => {
    await db.update(receipts).set({ status: "failed", detail, updatedAt: new Date() }).where(eq(receipts.id, id));
    return { status: "failed", detail };
  };

  const file = await getReceipt(row.vaultId).catch(() => null);
  if (!file?.body) return fail("Vault would not hand the photograph back.");
  const bytes = Buffer.from(await new Response(file.body).arrayBuffer());

  let result;
  try {
    result = await analyzeReceipt(bytes, { defaultCurrency: "GBP" });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (!result.ok || !result.receipt) return fail(result.errorMessage ?? "The photograph could not be read.");

  const r = result.receipt;
  const purchasedAt = r.purchasedAt ? r.purchasedAt.slice(0, 10) : null;
  const seenOn = dayOf(row.createdAt);
  const total = r.total ?? null;

  const facts = {
    merchant: r.merchantName,
    total,
    currency: r.currency ?? "GBP",
    purchasedAt,
    cardLast4: r.cardLast4,
    items: (r.lineItems ?? []).map((i) => ({ name: i.description, total: i.total, quantity: i.quantity ?? null })),
    warnings: result.warnings.map((w) => w.message ?? String(w)),
    path: result.path ?? null,
    ocrConfidence: Math.round(result.ocr.confidence),
  };

  /* No legible total means nothing to match on. The reading is kept —
   * the line items are still worth having — and it waits for you. */
  if (total === null) {
    await db.update(receipts).set({ ...facts, status: "unmatched", detail: "No total could be read.", updatedAt: new Date() }).where(eq(receipts.id, id));
    return { status: "unmatched", detail: "No total could be read." };
  }

  const on = purchasedAt ?? seenOn;
  const { pick } = matchReceipt({ total, purchasedAt, merchant: r.merchantName, seenOn }, await candidates(on));
  await db
    .update(receipts)
    .set({ ...facts, txId: pick, linkedBy: pick ? "figures" : null, status: pick ? "matched" : "unmatched", detail: pick ? null : "No payment in the feed matches this total.", updatedAt: new Date() })
    .where(eq(receipts.id, id));
  return { status: pick ? "matched" : "unmatched" };
}

/** The payments a person can choose from when Nori would not. */
export async function choicesFor(id: number) {
  const [row] = await db.select().from(receipts).where(eq(receipts.id, id));
  if (!row) return [];
  const on = row.purchasedAt ?? dayOf(row.createdAt) ?? londonToday();
  const list = await candidates(on);
  if (row.total === null) return list.sort((a, b) => (a.day > b.day ? -1 : 1)).slice(0, 20);
  const { ranked } = matchReceipt({ total: row.total, purchasedAt: row.purchasedAt, merchant: row.merchant, seenOn: dayOf(row.createdAt) }, list);
  const byId = new Map(list.map((t) => [t.id, t]));
  return ranked.map((r) => ({ ...byId.get(r.id)!, why: r.why }));
}
