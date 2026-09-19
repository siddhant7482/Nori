import { cap, gbp, list, nth, round, words } from "./format";
import { addDays, diff, short, ymd, type Day } from "./london";
import type { Cycle } from "./payday";
import { dueTotal, type Due } from "./recurring";

/* ============================================================
   THE CYCLE, as arithmetic.

   Pure: rows in, figures out, no database and no clock. Every
   number on Home, the hub and the "can I afford it?" answer comes
   out of computeMonth, so they cannot disagree with each other.

   The daily number is Warden's arithmetic applied to money:
     what's left in the budgets you spend from
     ÷ the days still to get through, today included.
   Today counts as a day left, which is the honest reading in the
   morning and never divides by zero on the last day.

   What is already decided is set aside first. Rent and the direct
   debits that have not left yet are not spending money, so the daily
   number reserves them: "left a day" is what is free after them.

   An over budget BORROWS, visibly: the shortfall comes out of the
   budget with the most room, the lender really does have less, and
   both reset on payday. Nothing is hidden and nothing is forgiven.
   ============================================================ */

export interface CatIn {
  id: string;
  name: string;
  hex: string;
  limit: number;
  fixed: boolean;
  position: number;
}

export interface TxIn {
  id: string;
  day: Day;
  amount: number;
  kind: "spend" | "refund" | "income" | "pot" | "transfer" | "ignored";
  categoryId: string | null;
  description: string;
  merchantName: string | null;
  counterpartyName: string | null;
  potId: string | null;
}

export interface CatOut extends CatIn {
  /** Recurring payments still to leave this budget before payday. */
  due: number;
  /** What came out of it this cycle, refunds netted off. */
  spent: number;
  /** The budget after IOUs: less if it lent, more if it borrowed. */
  eff: number;
  /** Counts in the daily number: not fixed, and a budget is set. */
  daily: boolean;
  byDay: number[];
  room: number;
  perDayLeft: number;
  perDaySoFar: number;
  /** Where it finishes if the rest of the cycle goes like the start. */
  pace: number;
  /** Day index on which it first went over its own budget. */
  crossDay: number | null;
}

export interface Iou {
  from: string;
  to: string;
  amount: number;
  day: number | null;
}

export type Voice = "clean" | "direct" | "warden";
export type Said = Record<Voice, { head: string; body: string }>;

export interface Month {
  cycle: Cycle;
  /** Recurring payments still to leave before payday, soonest first. */
  due: Due[];
  /** All of it, whatever budget it belongs to. */
  committed: number;
  /** The part of it that comes out of the budgets you spend from, and
   *  so is held back from the daily number. */
  reserved: number;
  /** What the daily number would have been without reserving. */
  leftADayBefore: number;
  today: Day;
  cats: CatOut[];
  income: number;
  /** Net into pots this cycle. */
  saved: number;
  dailyLimit: number;
  dailySpent: number;
  /** The daily allowance the budgets set on day one. */
  allow: number;
  /** THE number: left a day, until payday, today included. */
  leftADay: number;
  /** Where the daily budgets finish at the current pace. */
  proj: number;
  ious: Iou[];
  unfiled: TxIn[];
  unfiledTotal: number;
  /** Everything spent per day across the daily budgets. */
  byDay: number[];
  said: Said;
  daysToPayday: number;
}

/** Spending is what left the account, so it is the NEGATED amount: a
 *  £4.50 coffee is -450 in Monzo and 450 spent here, and a refund
 *  (positive in Monzo) nets off whatever it refunds. */
export const spentOf = (t: { amount: number }) => -t.amount;

export function computeMonth(input: { cats: CatIn[]; txs: TxIn[]; cycle: Cycle; today: Day; due?: Due[] }): Month {
  const { cycle, today } = input;
  const due = input.due ?? [];
  const { daysIn, dayIndex, daysLeft } = cycle;
  const inCycle = input.txs.filter((t) => t.day >= cycle.start && t.day <= today);

  const cats: CatOut[] = [...input.cats]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ ...c, spent: 0, due: 0, eff: c.limit, daily: !c.fixed && c.limit > 0, byDay: new Array(daysIn).fill(0), room: 0, perDayLeft: 0, perDaySoFar: 0, pace: 0, crossDay: null }));
  const byId = new Map(cats.map((c) => [c.id, c]));

  const unfiled: TxIn[] = [];
  let income = 0, saved = 0;
  for (const t of inCycle) {
    if (t.kind === "income") income += t.amount;
    else if (t.kind === "pot") saved -= t.amount;
    else if (t.kind === "spend" || t.kind === "refund") {
      const c = t.categoryId ? byId.get(t.categoryId) : undefined;
      if (!c) { unfiled.push(t); continue; }
      c.spent += spentOf(t);
      c.byDay[diff(cycle.start, t.day)] += spentOf(t);
    }
  }

  for (const d of due) {
    const c = d.series.categoryId ? byId.get(d.series.categoryId) : undefined;
    if (c) c.due += d.amount;
  }

  for (const c of cats) {
    let run = 0;
    for (let d = 0; d < dayIndex; d++) {
      run += c.byDay[d];
      if (c.crossDay === null && c.limit > 0 && run > c.limit) c.crossDay = d + 1;
    }
  }

  /* IOUs, in budget order so the result never depends on luck. */
  const daily = cats.filter((c) => c.daily);
  const room = (c: CatOut) => c.eff - c.spent;
  const ious: Iou[] = [];
  for (const c of daily) {
    const need = c.spent - c.limit;
    if (need <= 0) continue;
    const lender = daily.filter((k) => k !== c).sort((a, b) => room(b) - room(a) || a.position - b.position)[0];
    if (!lender) continue;
    const amt = Math.min(need, Math.max(0, room(lender)));
    if (!amt) continue;
    lender.eff -= amt;
    c.eff += amt;
    ious.push({ from: lender.id, to: c.id, amount: amt, day: c.crossDay });
  }

  for (const c of cats) {
    c.room = c.eff - c.spent;
    c.perDayLeft = Math.max(0, Math.round((c.room - Math.min(c.due, Math.max(0, c.room))) / daysLeft));
    c.perDaySoFar = Math.round(c.spent / dayIndex);
    c.pace = Math.round((c.spent / dayIndex) * daysIn);
  }

  const dailyLimit = daily.reduce((n, c) => n + c.limit, 0);
  const dailySpent = daily.reduce((n, c) => n + c.spent, 0);
  /* Only what a budget can still cover is held back: a bill bigger
   * than what is left of its budget is already an overspend, and
   * reserving money that is not there would make the daily number
   * negative rather than honest. */
  const reserved = daily.reduce((n, c) => n + Math.min(c.due, Math.max(0, c.eff - c.spent)), 0);
  const free = dailyLimit - dailySpent - reserved;
  const byDay = new Array(daysIn).fill(0);
  for (const c of daily) c.byDay.forEach((v, i) => (byDay[i] += v));

  const m: Month = {
    cycle,
    today,
    cats,
    income,
    saved,
    dailyLimit,
    dailySpent,
    allow: Math.round(dailyLimit / daysIn),
    due,
    committed: dueTotal(due),
    reserved,
    leftADay: Math.max(0, Math.round(free / daysLeft)),
    leftADayBefore: Math.max(0, Math.round((dailyLimit - dailySpent) / daysLeft)),
    proj: Math.round((dailySpent / dayIndex) * daysIn),
    ious,
    unfiled,
    unfiledTotal: unfiled.reduce((n, t) => n + spentOf(t), 0),
    byDay,
    said: { clean: { head: "", body: "" }, direct: { head: "", body: "" }, warden: { head: "", body: "" } },
    daysToPayday: Math.max(1, diff(today, cycle.nextPayday)),
  };
  m.said = speak(m);
  return m;
}

export function catById(m: Month, id: string): CatOut | undefined {
  return m.cats.find((c) => c.id === id);
}

export const dayOfCycle = (m: Month, index: number): Day => addDays(m.cycle.start, index - 1);

/* ------------------------------------------------------------
   The voice: whatever is most wrong right now, said three ways.
   Never sent anywhere. It lives in Nori and on the hub.
   ------------------------------------------------------------ */
function speak(m: Month): Said {
  const L = words(m.daysToPayday);
  const pay = nth(ymd(m.cycle.nextPayday).day);
  const dailyCats = m.cats.filter((c) => c.daily);

  if (!dailyCats.length) {
    const t = "No budgets set yet.";
    const b = "Set one in Settings and this becomes a number you can spend by.";
    return { clean: { head: t, body: b }, direct: { head: t, body: b }, warden: { head: "Nothing to hold you to yet.", body: b } };
  }

  const worst = [...m.ious].sort((a, b) => b.amount - a.amount)[0];
  if (worst) {
    const to = catById(m, worst.to)!, from = catById(m, worst.from)!;
    const over = to.spent - to.limit, per = gbp(from.perDayLeft), fl = from.name.toLowerCase(), eat = /eat|food|takeaway|restaurant/i.test(to.name);
    const passed = to.crossDay ? " on " + short(dayOfCycle(m, to.crossDay)) : "";
    return {
      clean: { head: `${to.name} is ${gbp(over)} over budget, with ${L} days until payday.`, body: `The difference has been covered from ${fl}, which now has ${per} a day until the ${pay}.` },
      direct: { head: `${to.name} is ${gbp(over)} over, with ${L} days to payday.`, body: `You passed ${round(to.limit)}${passed}. The ${gbp(over)} since came out of ${fl}, which now has ${per} a day until the ${pay}.` },
      warden: {
        head: `${cap(L)} days to payday and ${to.name.toLowerCase()} is ${gbp(over)} over.`,
        body: `That money was ${fl}. ${eat ? "You've already eaten it, and " : "It's gone, and "}${fl} now has ${per} a day. ${eat ? "Cook something, for fuck's sake." : "Put the card away, for fuck's sake."}`,
      },
    };
  }

  const uncovered = dailyCats.filter((c) => c.spent > c.eff);
  if (uncovered.length) {
    const names = list(uncovered.map((c) => c.name.toLowerCase()));
    const t = m.dailySpent - m.dailyLimit;
    return {
      clean: { head: `Everything you budgeted for is spent, with ${L} days to payday.`, body: `The budgets are ${gbp(t)} over between them, led by ${names}.` },
      direct: { head: `Every budget is empty and there are ${L} days left.`, body: `${cap(names)} went over and nothing had room to lend. You're ${gbp(t)} past the lot.` },
      warden: { head: `${cap(L)} days to payday and there's nothing left.`, body: `${gbp(t)} over, across the board. Stop spending, for fuck's sake.` },
    };
  }

  const slip = dailyCats.filter((c) => c.pace > c.eff).sort((a, b) => b.pace - b.eff - (a.pace - a.eff))[0];
  if (slip) {
    const by = gbp(slip.pace - slip.eff), a = gbp(slip.perDaySoFar), b = gbp(slip.perDayLeft);
    return {
      clean: { head: `${slip.name} is on pace to finish ${by} over.`, body: `It has ${b} a day left and has been averaging ${a}.` },
      direct: { head: `${slip.name} is heading ${by} over, with ${L} days to payday.`, body: `You've been spending ${a} a day; it has ${b} a day left. Nothing has gone wrong yet, and this is when it's cheap to fix.` },
      warden: { head: `${cap(L)} days to payday and ${slip.name.toLowerCase()} is heading ${by} over.`, body: `${a} a day going out, ${b} a day allowed. You can see this coming. Act like it.` },
    };
  }

  const d = gbp(m.leftADay);
  return {
    clean: { head: `Everything is inside its budget, with ${L} days to payday.`, body: `${d} a day keeps it there.` },
    direct: { head: `Every budget is intact, ${L} days out.`, body: `${d} a day until the ${pay} and it closes clean.` },
    warden: { head: "Nothing's over. Don't get comfortable.", body: `${d} a day for ${L} days. That's the whole job.` },
  };
}

/* ------------------------------------------------------------
   Can I afford it? The whole answer is arithmetic: what's left,
   less the price, over the days left. If the budget it belongs to
   is empty it borrows from the one with most room, exactly as an
   overspend does. Shared with the client, so it stays pure.
   ------------------------------------------------------------ */
export interface AffordIn {
  daysLeft: number;
  /** Already spoken for before payday, and so not spendable. */
  reserved: number;
  leftADay: number;
  dailyLimit: number;
  dailySpent: number;
  iouCount: number;
  cats: { id: string; name: string; room: number; daily: boolean; position: number }[];
}

export type Afford =
  | { kind: "no"; p: number; left: number; before: number; short: number }
  | { kind: "fits"; p: number; left: number; before: number; after: number; cat: string; catAfter: number }
  | { kind: "iou"; p: number; left: number; before: number; after: number; cat: string; own: number; need: number; lender: string; lenderAfter: number; more: boolean; nth: number };

export function afford(a: AffordIn, p: number, catId: string | null): Afford | null {
  if (!(p > 0)) return null;
  const left = a.dailyLimit - a.dailySpent - a.reserved;
  const after = left - p;
  const base = { p, left, before: a.leftADay };
  if (after < 0) return { kind: "no", ...base, short: -after };
  const daily = a.cats.filter((c) => c.daily);
  const byRoom = (x: { room: number; position: number }, y: { room: number; position: number }) => y.room - x.room || x.position - y.position;
  const t = (catId && daily.find((c) => c.id === catId)) || [...daily].sort(byRoom)[0];
  if (!t) return null;
  const perDay = (v: number) => Math.max(0, Math.round(v / a.daysLeft));
  if (t.room >= p) return { kind: "fits", ...base, after: perDay(after), cat: t.name, catAfter: perDay(t.room - p) };
  const own = Math.max(0, t.room);
  const need = p - own;
  const lender = daily.filter((c) => c !== t).sort(byRoom)[0];
  if (!lender) return { kind: "no", ...base, short: need };
  return { kind: "iou", ...base, after: perDay(after), cat: t.name, own, need, lender: lender.name, lenderAfter: perDay(lender.room - need), more: lender.room < need, nth: a.iouCount + 1 };
}

export function affordText(r: Afford, v: Voice, daysLeft: number): string {
  const L = words(daysLeft);
  if (r.kind === "no")
    return {
      clean: `No. It's ${gbp(r.short)} more than everything left until payday.`,
      direct: `No. It's ${gbp(r.short)} more than everything you have left for ${L} days, bills aside.`,
      warden: `No. You don't have it, not even if every other budget starves. ${gbp(r.short)} short.`,
    }[v];
  const diffDay = gbp(r.before - r.after), cl = r.cat.toLowerCase();
  if (r.kind === "fits")
    return {
      clean: `Yes. It comes out of ${cl}, which keeps ${gbp(r.catAfter)} a day. Your daily number goes from ${gbp(r.before)} to ${gbp(r.after)}.`,
      direct: `Yes. ${r.cat} has room and keeps ${gbp(r.catAfter)} a day. It costs you ${diffDay} a day for the next ${L}.`,
      warden: `Yes, ${cl} can take it. It still costs you ${diffDay} a day for ${L} days. Worth it? Your call.`,
    }[v];
  const ln = r.lender.toLowerCase();
  const which = r.nth === 1 ? "an" : r.nth === 2 ? "a second" : r.nth === 3 ? "a third" : "yet another";
  return {
    clean: `Only by borrowing. ${r.cat} has ${r.own ? gbp(r.own) : "nothing"} left, so ${ln} would lend ${gbp(r.need)}${r.more ? " and more besides" : ""}, keeping ${gbp(r.lenderAfter)} a day.`,
    direct: `Only with another IOU. ${r.cat} has ${r.own ? "just " + gbp(r.own) : "nothing"} left, so ${ln} lends ${gbp(r.need)} and drops to ${gbp(r.lenderAfter)} a day. That's ${which} IOU this cycle.`,
    warden: `Only by raiding ${ln} for ${gbp(r.need)}. ${cap(which)} IOU in one cycle, ${L} days from payday. Put it down.`,
  }[v];
}

export function affordInput(m: Month): AffordIn {
  return {
    daysLeft: m.cycle.daysLeft,
    reserved: m.reserved,
    leftADay: m.leftADay,
    dailyLimit: m.dailyLimit,
    dailySpent: m.dailySpent,
    iouCount: m.ious.length,
    /* A budget's room is what is left after what it still owes: a
     * fiver of grocery budget that rent will take is not a fiver. */
    cats: m.cats.map((c) => ({ id: c.id, name: c.name, room: Math.max(0, c.room - c.due), daily: c.daily, position: c.position })),
  };
}
