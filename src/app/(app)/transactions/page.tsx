import { Head } from "@/components/bits";
import { TxBrowser, type TxRow } from "@/components/TxBrowser";
import { cycleTransactions, getPicture } from "@/lib/data";
import { MONZO_CATEGORIES } from "@/lib/filing";
import { short } from "@/lib/london";

/* ============================================================
   3 · TRANSACTIONS. One payday cycle at a time, newest first, every
   row straight from Monzo. The unfiled ones sit on top until filed.
   ============================================================ */

export const dynamic = "force-dynamic";

export default async function Transactions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const offset = Math.max(0, Math.min(24, parseInt(sp.c ?? "0", 10) || 0));
  const pic = await getPicture();
  const { start, end, rows, hasEarlier } = await cycleTransactions(offset);
  const cats = pic.month.cats.map((c) => ({ id: c.id, name: c.name, hex: c.hex, fixed: c.fixed }));
  const data: TxRow[] = rows.map((t) => ({
    id: t.id,
    day: t.day,
    time: t.created.toISOString(),
    amount: t.amount,
    kind: t.kind,
    categoryId: t.categoryId,
    filedBy: t.filedBy,
    description: t.description,
    label: t.merchantName ?? t.counterpartyName ?? t.description,
    merchantGroupId: t.merchantGroupId,
    monzoCategory: t.monzoCategory ? (MONZO_CATEGORIES[t.monzoCategory] ?? t.monzoCategory) : null,
    pending: !t.settled && t.kind !== "income",
    notes: t.notes,
  }));
  const which = offset === 0 ? "THIS CYCLE" : offset === 1 ? "LAST CYCLE" : `${offset} CYCLES AGO`;
  return (
    <>
      <Head title="Transactions" meta={`${which} · ${short(start)} – ${short(end)} · ${rows.length} FROM MONZO, NONE TYPED IN`} />
      <TxBrowser
        rows={data}
        cats={cats}
        offset={offset}
        hasEarlier={hasEarlier}
        initial={{ show: sp.show === "unfiled" || sp.show === "spend" || sp.show === "in" ? sp.show : "all", cat: sp.cat ?? null, tx: sp.tx ?? null, q: sp.q ?? "" }}
      />
    </>
  );
}
