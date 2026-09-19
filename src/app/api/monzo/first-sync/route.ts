import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { monzo, MonzoError } from "@/monzo/client";
import { accessToken, getConnection } from "@/monzo/oauth";
import { syncOnce } from "@/monzo/sync";

export const dynamic = "force-dynamic";

/* ============================================================
   Polled by Settings every few seconds after you connect.

   Until you approve Nori in the Monzo app, every read is refused
   (403) and this answers "waiting". The first poll that gets through
   runs the full-history sync right there, inside Monzo's window, and
   any poll that arrives while it runs answers "syncing".
   ============================================================ */

const WINDOW_SECONDS = 300;

export async function POST() {
  const conn = await getConnection();
  if (!conn) return NextResponse.json({ state: "error", message: "Monzo isn't connected. Start again from Settings." });

  if (conn.approvedAt) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);
    return NextResponse.json({ state: "done", fetched: n, fullHistory: conn.fullHistory });
  }
  const secondsLeft = Math.round(WINDOW_SECONDS - (Date.now() - conn.authorisedAt.getTime()) / 1000);

  try {
    const token = await accessToken();
    await monzo.accounts(token);
  } catch (e) {
    if (e instanceof MonzoError && e.forbidden) return NextResponse.json({ state: "waiting", secondsLeft });
    return NextResponse.json({ state: "error", message: e instanceof Error ? e.message : String(e) });
  }

  try {
    const r = await syncOnce("full");
    if (r === "busy") return NextResponse.json({ state: "syncing" });
    return NextResponse.json({ state: "done", fetched: r.fetched, fullHistory: Boolean(r.fullHistory) });
  } catch (e) {
    return NextResponse.json({ state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
