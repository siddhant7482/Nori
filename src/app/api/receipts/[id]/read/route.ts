import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { receipts } from "@/db/schema";
import { gbp } from "@/lib/format";
import { readReceipt } from "@/receipts/read";
import { registerRef } from "@/receipts/vault";

export const dynamic = "force-dynamic";
/* Tesseract on this box plus a model round trip. Usually well under a
 * minute; the client polls rather than waiting on this response. */
export const maxDuration = 300;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Which receipt?" }, { status: 400 });

  const result = await readReceipt(id);
  const [row] = await db.select().from(receipts).where(eq(receipts.id, id));
  if (row) {
    /* Now that there is something to say about it, tell Vault what the
     * file is for: whoever looks at it there should not have to guess. */
    const label = [row.merchant ?? "Receipt", row.total !== null ? gbp(row.total) : null, row.purchasedAt].filter(Boolean).join(" · ");
    await registerRef(row.vaultKey, label.slice(0, 120), `/receipts?r=${id}`);
  }
  return NextResponse.json({ ...result, receipt: row ?? null });
}
