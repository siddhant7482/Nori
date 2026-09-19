import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { receipts } from "@/db/schema";
import { getReceipt } from "@/receipts/vault";

export const dynamic = "force-dynamic";

/* The photograph, fetched from Vault with the machine key and passed
 * through. The browser is signed into Nori, not Vault, so it cannot
 * reach the file itself — and Vault's own short-lived link never has
 * to be handed out. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new NextResponse(null, { status: 400 });
  const [row] = await db.select({ vaultId: receipts.vaultId }).from(receipts).where(eq(receipts.id, id));
  if (!row) return new NextResponse(null, { status: 404 });
  const file = await getReceipt(row.vaultId).catch(() => null);
  if (!file?.body) return new NextResponse(null, { status: 502 });
  return new NextResponse(file.body, { headers: { "content-type": file.type, "cache-control": "private, max-age=3600" } });
}
