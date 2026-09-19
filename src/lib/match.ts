import { diff, type Day } from "./london";

/* ============================================================
   WHICH PAYMENT THIS RECEIPT IS FOR.

   The bank is the record, so a receipt does not create anything: it
   attaches to a payment Monzo already has, or it sits unmatched
   until you say which one.

   What decides it, in order:
     · the total, to the penny. A receipt whose total is not in the
       feed is not that payment, however plausible the shop.
     · the date. Card payments settle a day or two after the shop
       takes them, so a receipt dated Friday can belong to a payment
       recorded on Sunday, but not to one a fortnight away.
     · the name, last, to break a tie between two identical amounts.

   Nori attaches it by itself only when one payment fits and nothing
   else comes close. Anything less is a list for you to pick from,
   because a receipt on the wrong payment is worse than none: it
   would put line items and a warranty against something you did not
   buy, and nothing later would ever question it.
   ============================================================ */

export interface Candidate {
  id: string;
  day: Day;
  /** Monzo's sign: money out is negative. */
  amount: number;
  merchantName: string | null;
  description: string;
}

export interface ReceiptFacts {
  total: number;
  purchasedAt: Day | null;
  merchant: string | null;
  /** Fallback when the receipt has no legible date. */
  seenOn: Day;
}

export interface Ranked {
  id: string;
  score: number;
  why: string;
  exact: boolean;
  days: number;
}

export interface MatchResult {
  /** Attached without asking, or null when it is your call. */
  pick: string | null;
  ranked: Ranked[];
}

/** A few pence of rounding is normal; anything more is another payment. */
const PENNY_SLACK = 2;
/** A card payment can appear days after the shop took it. */
const DAY_SLACK = 4;

const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(LTD|LIMITED|UK|PLC|THE|STORE|LOCAL|EXPRESS)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function namesAgree(a: string | null, b: Candidate): boolean {
  if (!a) return false;
  const want = norm(a);
  if (!want) return false;
  for (const side of [b.merchantName, b.description]) {
    const have = norm(side ?? "");
    if (!have) continue;
    if (have.includes(want) || want.includes(have)) return true;
    const first = want.split(" ")[0];
    if (first.length >= 4 && have.includes(first)) return true;
  }
  return false;
}

export function matchReceipt(r: ReceiptFacts, txs: Candidate[]): MatchResult {
  const on = r.purchasedAt ?? r.seenOn;
  const ranked: Ranked[] = [];

  for (const t of txs) {
    const spent = -t.amount;
    if (spent <= 0) continue;
    const pennies = Math.abs(spent - r.total);
    const exact = pennies <= PENNY_SLACK;
    /* Off by more than a few percent and it is simply another
     * payment; there is no "close enough" for money. */
    if (!exact && pennies > Math.max(50, r.total * 0.02)) continue;
    const days = Math.abs(diff(on, t.day));
    if (days > 14) continue;

    const agree = namesAgree(r.merchant, t);
    const score = (exact ? 100 : 60) + Math.max(0, 40 - days * 10) + (agree ? 25 : 0);
    const why = [exact ? "same total" : `${(pennies / 100).toFixed(2)} out`, days === 0 ? "same day" : `${days} day${days === 1 ? "" : "s"} apart`, agree ? "same shop" : null].filter(Boolean).join(" · ");
    ranked.push({ id: t.id, score, why, exact, days });
  }

  ranked.sort((a, b) => b.score - a.score || a.days - b.days);
  const best = ranked[0], next = ranked[1];
  /* One payment fits and nothing else is nearly as good. A second
   * candidate within striking distance means two payments of the same
   * amount days apart, and guessing between them is exactly the
   * mistake this refuses to make. */
  const pick = best && best.exact && best.days <= DAY_SLACK && (!next || best.score - next.score >= 25) ? best.id : null;
  return { pick, ranked: ranked.slice(0, 6) };
}
