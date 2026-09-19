"use client";

import { useState } from "react";
import { gbp } from "@/lib/format";
import { afford, affordText, type AffordIn, type Voice } from "@/lib/month";

/* ============================================================
   Can I afford it? Type a price, see the daily number move before
   you pay rather than after. Pure arithmetic on the cycle's figures,
   worked out in the browser as you type.
   ============================================================ */

const CHIPS = [12, 45, 60, 150, 300];

export function Afford({ id, input, voice, start = 60, cat = "", autoFocus = false }: { id: string; input: AffordIn; voice: Voice; start?: number; cat?: string; autoFocus?: boolean }) {
  const [amount, setAmount] = useState(String(start));
  const [category, setCategory] = useState(cat);
  const pounds = parseFloat(amount.replace(/[£,\s]/g, ""));
  const p = Number.isFinite(pounds) ? Math.round(pounds * 100) : NaN;
  const r = afford(input, p, category || null);
  const daily = input.cats.filter((c) => c.daily);

  return (
    <div className="aw">
      <div className="aw-in">
        <label className="pound" htmlFor={id + "-amt"}>£</label>
        <input id={id + "-amt"} inputMode="decimal" value={amount} autoComplete="off" aria-label="Price in pounds" autoFocus={autoFocus} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setAmount(e.target.value)} />
        <select id={id + "-cat"} aria-label="Which budget it comes from" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Wherever there&apos;s room</option>
          {daily.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="chips">
        {CHIPS.map((v) => (
          <button key={v} type="button" onClick={() => setAmount(String(v))}>£{v}</button>
        ))}
      </div>
      <div aria-live="polite">
        {!daily.length ? (
          <div className="aw-out"><span className="k">No budgets yet</span><p>Set your budgets in Settings and this can answer.</p></div>
        ) : !r ? (
          <div className="aw-out"><span className="k">Type a price</span><p>Nori shows what it does to your daily number before you spend it.</p></div>
        ) : (
          <div className={"aw-out" + (r.kind === "fits" ? "" : " bad")}>
            <span className="k">{r.kind === "no" ? "You'd be short by" : r.kind === "iou" ? "Only with an IOU · your daily number" : "Your daily number would be"}</span>
            <div className="n">
              {r.kind === "no" ? gbp(r.short) : (<>{gbp(r.after)}<s>{gbp(r.before)}</s></>)}
            </div>
            <p>{affordText(r, voice, input.daysLeft)}</p>
            <div className="moves">
              {r.kind === "fits" && <div><span>From {r.cat}</span><span>−{gbp(r.p)}</span></div>}
              {r.kind === "iou" && r.own > 0 && <div><span>From {r.cat}</span><span>−{gbp(r.own)}</span></div>}
              {r.kind === "iou" && <div><span>IOU · {r.lender} lends</span><span>−{gbp(r.need)}</span></div>}
              <div><span>Left until payday</span><span>{gbp(r.left)} → {gbp(Math.max(0, r.left - r.p))}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
