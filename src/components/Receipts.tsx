"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { forgetReceipt, linkReceipt } from "@/app/actions";
import { gbp } from "@/lib/format";
import { short, withDay } from "@/lib/london";
import { Hd } from "./bits";
import { toast } from "./toast";

export interface ReceiptView {
  id: number;
  status: "reading" | "matched" | "unmatched" | "failed";
  name: string;
  merchant: string | null;
  total: number | null;
  purchasedAt: string | null;
  cardLast4: string | null;
  items: { name: string; total: number; quantity?: number | null }[] | null;
  warnings: string[] | null;
  path: string | null;
  ocrConfidence: number | null;
  detail: string | null;
  seenOn: string;
  tx: { id: string; day: string; amount: number; label: string; category: string | null } | null;
  choices: { id: string; day: string; amount: number; label: string; why: string }[];
}

/* ============================================================
   8 · RECEIPTS. Photograph it; the bank already has the payment.

   The photograph goes to Vault, the figures stay here, and the two
   are joined to a payment Monzo recorded. Anything Nori will not
   join by itself sits at the top waiting for you, because a receipt
   attached to the wrong payment is worse than one not attached.
   ============================================================ */

export function Receipts({ rows }: { rows: ReceiptView[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function snap(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        setBusy(`Sending ${file.name} to Vault…`);
        const up = await fetch("/api/receipts", { method: "POST", headers: { "content-type": file.type || "image/jpeg" }, body: file });
        const made = (await up.json()) as { id?: number; error?: string };
        if (!up.ok || !made.id) throw new Error(made.error ?? "Vault would not take it.");
        setBusy("Reading it…");
        const read = await fetch(`/api/receipts/${made.id}/read`, { method: "POST" });
        const done = (await read.json().catch(() => ({}))) as { status?: string; detail?: string };
        toast(done.status === "matched" ? "Read it and attached it to the payment." : done.status === "unmatched" ? "Read it. No payment matched, so it's waiting for you." : `Couldn't read it: ${done.detail ?? "unknown"}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  const waiting = rows.filter((r) => r.status !== "matched");
  const done = rows.filter((r) => r.status === "matched");

  return (
    <>
      <div className="card">
        <Hd title="Snap a receipt" right="PHOTO GOES TO VAULT" />
        <p className="sub">Nori reads it on the node, checks its arithmetic, and attaches it to the payment Monzo already recorded. Nothing is typed in and nothing is invented: what it can&apos;t place waits for you.</p>
        <label className="snap">
          <input ref={input} type="file" accept="image/*" capture="environment" multiple onChange={(e) => snap(e.target.files)} disabled={Boolean(busy)} />
          <span>{busy ?? "Take a photo, or choose one"}</span>
        </label>
      </div>

      {waiting.length > 0 && (
        <div className="card">
          <Hd title={`Needs you · ${waiting.length}`} right="NOT ATTACHED YET" />
          <div className="rgrid">
            {waiting.map((r) => <Card key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div className="card">
          <Hd title="Attached" right={`${done.length} RECEIPT${done.length === 1 ? "" : "S"}`} />
          <div className="rgrid">
            {done.map((r) => <Card key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {!rows.length && <p className="empty">No receipts yet. The first photograph starts the pile.</p>}
    </>
  );
}

function Card({ r }: { r: ReceiptView }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const act = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const res = await fn();
      toast(res.message);
      router.refresh();
    });

  const tag =
    r.status === "matched" ? <span className="tag">ATTACHED</span> : r.status === "reading" ? <span className="tag mute">READING</span> : r.status === "failed" ? <span className="tag over">COULDN&apos;T READ</span> : <span className="tag story">NO MATCH</span>;

  return (
    <div className="rc">
      <button type="button" className="rc-shot" onClick={() => setOpen((v) => !v)} aria-label="The photograph">
        <Image src={`/api/receipts/${r.id}/image`} alt="" width={220} height={280} unoptimized />
      </button>
      <div className="rc-body">
        <div className="c">
          <span>{r.merchant ?? r.name}</span>
          {tag}
        </div>
        <div className="a">{r.total !== null ? gbp(r.total) : "—"}</div>
        <div className="of">
          {r.purchasedAt ? withDay(r.purchasedAt) : `snapped ${short(r.seenOn)}`}
          {r.cardLast4 ? ` · card ···${r.cardLast4}` : ""}
          {r.path ? ` · read ${r.path === "vision" ? "by the model" : "on the node"}` : ""}
        </div>

        {r.tx ? (
          <p className="fb">
            On <b>{r.tx.label}</b> · {gbp(-r.tx.amount)} · {short(r.tx.day)}{" "}
            <button className="lnk" type="button" disabled={busy} onClick={() => act(() => linkReceipt(r.id, null))}>not this one</button>
          </p>
        ) : r.choices.length ? (
          <div className="rc-pick">
            <span className="eb">Which payment is this?</span>
            {r.choices.map((c) => (
              <button key={c.id} type="button" className="rc-choice" disabled={busy} onClick={() => act(() => linkReceipt(r.id, c.id))}>
                <span>{c.label}</span>
                <span className="num">{gbp(-c.amount)}</span>
                <span className="h">{short(c.day)} · {c.why}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="fb">{r.detail ?? "Nothing in the feed comes close to this total."}</p>
        )}

        {r.warnings?.length ? <p className="fb" style={{ color: "var(--over-ink)" }}>The sums don&apos;t agree: {r.warnings.join("; ")}</p> : null}

        {r.items?.length ? (
          <details className="tablev">
            <summary>{r.items.length} line{r.items.length === 1 ? "" : "s"}{open ? "" : ""}</summary>
            <div className="tw">
              <table>
                <tbody>
                  {r.items.map((i, k) => (
                    <tr key={k}>
                      <td>{i.quantity && i.quantity > 1 ? `${i.quantity} × ` : ""}{i.name}</td>
                      <td>{gbp(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}

        <button className="lnk" type="button" disabled={busy} onClick={() => act(() => forgetReceipt(r.id))}>Forget this reading</button>
      </div>
    </div>
  );
}
