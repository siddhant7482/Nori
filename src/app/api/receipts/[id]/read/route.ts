import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { receipts } from "@/db/schema";
import { gbp } from "@/lib/format";
import { registerRef } from "@/receipts/vault";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Reading happens in its own process (src/receipts/run-read.ts): OCR
 * loads a worker and a lot of wasm, and neither belongs in the thing
 * that renders pages. NORI_HOME is the repo on the node, because the
 * standalone server runs two directories down from it. */
const home = () => process.env.NORI_HOME || process.cwd();

function read(id: number): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["-s", "read", String(id)], { cwd: home(), env: process.env, shell: process.platform === "win32" });
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => resolve({ code: 1, err: e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, err }));
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Which receipt?" }, { status: 400 });

  const { code, err } = await read(id);
  const [row] = await db.select().from(receipts).where(eq(receipts.id, id));
  if (!row) return NextResponse.json({ status: "failed", detail: "That receipt is not here any more." }, { status: 404 });

  if (code !== 0 && row.status === "reading") {
    const detail = err.trim().split("\n").pop()?.slice(0, 200) || "The reader stopped without saying why.";
    await db.update(receipts).set({ status: "failed", detail, updatedAt: new Date() }).where(eq(receipts.id, id));
    return NextResponse.json({ status: "failed", detail, receipt: { ...row, status: "failed", detail } });
  }

  /* Now that there is something to say about it, tell Vault what the
   * file is for: whoever looks at it there should not have to guess. */
  const label = [row.merchant ?? "Receipt", row.total !== null ? gbp(row.total) : null, row.purchasedAt].filter(Boolean).join(" · ");
  await registerRef(row.vaultKey, label.slice(0, 120), `/receipts?r=${id}`);

  return NextResponse.json({ status: row.status, detail: row.detail, receipt: row });
}
