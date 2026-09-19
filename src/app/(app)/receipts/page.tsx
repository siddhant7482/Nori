import { Head } from "@/components/bits";
import { Receipts, type ReceiptView } from "@/components/Receipts";
import { allReceipts } from "@/lib/data";
import { dayOf } from "@/lib/london";
import { choicesFor } from "@/receipts/read";
import { vaultConfigured } from "@/receipts/vault";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const rows = await allReceipts();
  const waiting = rows.filter((r) => r.r.status !== "matched" && r.r.total !== null).slice(0, 12);
  const choices = new Map(await Promise.all(waiting.map(async (r) => [r.r.id, await choicesFor(r.r.id)] as const)));

  const view: ReceiptView[] = rows.map(({ r, tx }) => ({
    id: r.id,
    status: r.status,
    name: r.name,
    merchant: r.merchant,
    total: r.total,
    purchasedAt: r.purchasedAt,
    cardLast4: r.cardLast4,
    items: r.items,
    warnings: r.warnings,
    path: r.path,
    ocrConfidence: r.ocrConfidence,
    detail: r.detail,
    seenOn: dayOf(r.createdAt),
    tx: tx?.id ? { id: tx.id, day: tx.day, amount: tx.amount, label: tx.merchantName ?? tx.description, category: tx.categoryId } : null,
    choices: (choices.get(r.id) ?? []).map((c) => ({ id: c.id, day: c.day, amount: c.amount, label: c.merchantName ?? c.description, why: "why" in c ? (c.why as string) : "" })),
  }));

  const matched = view.filter((v) => v.status === "matched").length;
  return (
    <>
      <Head title="Receipts" meta={`${view.length} THIS FAR · ${matched} ATTACHED · PHOTOS KEPT IN VAULT`} />
      {!vaultConfigured() && (
        <div className="card">
          <p className="howto">Receipts need Vault: set <code>VAULT_URL</code> and the shared <code>HQ_API_TOKEN</code> in Nori&apos;s <code>.env.local</code>, and the same token in Vault&apos;s. Until then there is nowhere to put a photograph.</p>
        </div>
      )}
      <Receipts rows={view} />
    </>
  );
}
