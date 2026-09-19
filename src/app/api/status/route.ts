import { NextResponse } from "next/server";
import { getPicture } from "@/lib/data";
import { gbp, words } from "@/lib/format";
import { catById } from "@/lib/month";
import type { AppStatus, StatusAlert, StatusLevel } from "@/lib/status-contract";

export const dynamic = "force-dynamic";

/* ============================================================
   What Nori tells the hub. Answer fast, never throw: a broken Nori
   says so in a headline rather than taking the panel down with it.

   The hub is the only other place Nori's voice is allowed to speak,
   so the headline IS the voice: the same sentence Home leads with.
   `attention` is for things a person must act on: an unfiled
   payment, a budget over, a Monzo connection that stopped.
   ============================================================ */

export async function GET() {
  const at = new Date().toISOString();
  try {
    const pic = await getPicture();
    const m = pic.month;
    if (!pic.conn.connected)
      return json({ app: "nori", level: "attention", headline: pic.conn.example ? "Example data · Monzo not connected" : "Monzo not connected", metrics: [], alerts: [{ text: "Connect Monzo to start Nori", severity: "soon", href: "/settings" }], at });
    if (!pic.conn.approved)
      return json({ app: "nori", level: "attention", headline: "Waiting for approval in the Monzo app", metrics: [], alerts: [{ text: "Approve Nori in the Monzo app", severity: "urgent", href: "/settings" }], at });

    const alerts: StatusAlert[] = [];
    let level: StatusLevel = "ok";
    if (pic.conn.lastError) {
      level = "warn";
      alerts.push({ text: `Nori's Monzo sync is failing: ${pic.conn.lastError}`.slice(0, 140), severity: "soon", href: "/settings" });
    }
    if (m.unfiled.length) {
      level = "attention";
      alerts.push({ text: `${m.unfiled.length} payment${m.unfiled.length === 1 ? "" : "s"} unfiled, ${gbp(m.unfiledTotal)}`, severity: "info", href: "/transactions?show=unfiled" });
    }
    for (const i of m.ious) {
      level = "attention";
      alerts.push({ text: `${catById(m, i.to)!.name} is over; ${catById(m, i.from)!.name.toLowerCase()} lent ${gbp(i.amount)}`, severity: "soon", href: `/transactions?cat=${i.to}` });
    }
    if (m.cycle.late) alerts.push({ text: "Payday was due and no salary has landed", severity: "soon", href: "/settings#payday" });

    const headline = m.dailyLimit ? `${gbp(m.leftADay)} a day · ${words(m.daysToPayday)} days to payday` : "No budgets set yet";
    return json({
      app: "nori",
      level,
      headline,
      metrics: [
        { label: "LEFT/DAY", value: gbp(m.leftADay) },
        { label: "PAYDAY", value: `${m.daysToPayday}D` },
        { label: "SAID", value: m.said[pic.voice].head },
      ],
      alerts,
      at,
    });
  } catch (e) {
    return json({ app: "nori", level: "down", headline: `Nori can't read its data: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120), metrics: [], alerts: [{ text: "Nori could not read its database", severity: "urgent" }], at });
  }
}

function json(status: AppStatus) {
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
