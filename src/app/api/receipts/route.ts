import { NextResponse } from "next/server";
import { db } from "@/db";
import { receipts } from "@/db/schema";
import { today } from "@/lib/london";
import { putReceipt, vaultConfigured } from "@/receipts/vault";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Photographs only, and not a whole camera roll's worth. */
const MAX_BYTES = 12 * 1024 * 1024;

/* Takes the photograph, puts it in Vault, and returns the receipt to
 * read. Reading is a separate request: it can take half a minute, and
 * a phone on a train should not have to hold the upload open for it. */
export async function POST(req: Request) {
  if (!vaultConfigured()) return NextResponse.json({ error: "Vault isn't connected. Set VAULT_URL and HQ_API_TOKEN in Nori's .env.local." }, { status: 503 });

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return NextResponse.json({ error: "Send a photograph." }, { status: 415 });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) return NextResponse.json({ error: "The photograph was empty." }, { status: 400 });
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: "That photograph is over 12 MB." }, { status: 413 });

  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("heic") ? "heic" : "jpg";
  const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
  const name = `receipt-${today()}-${stamp}.${ext}`;

  try {
    const stored = await putReceipt(bytes, name, type);
    const [row] = await db
      .insert(receipts)
      .values({ vaultId: stored.id, vaultKey: stored.key, name: stored.name, bytes: stored.bytes, status: "reading" })
      .returning({ id: receipts.id });
    return NextResponse.json({ id: row.id, name: stored.name }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
