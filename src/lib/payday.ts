import { addDays, diff, make, weekday, ymd, type Day } from "./london";

/* ============================================================
   Payday, found rather than typed.

   Budgets run payday to payday, because that is how long the money
   has to last. The pay is found in the feed: the largest credit that
   arrives from the same payer about once a month.

   Finding it automatically only works for a payslip landing from an
   employer. Plenty of people are paid into one bank and move the
   money to the one they spend from, and that transfer is their
   payday even though it comes from their own name. Nori cannot tell
   those apart by looking, so it stops guessing: it lists who pays
   you and you say which one is the pay. That answer wins over
   anything detection thinks. Its dates
   are then explained by a rule, so the NEXT payday can be predicted
   before it lands — that prediction is what "days left" divides by.

   Two rules cover almost every UK payslip:
     dom  the Nth of the month, or the Friday before when it falls
          on a weekend
     lwd  the last working day of the month
   Bank holidays are not modelled. If a salary lands a day early the
   new cycle simply starts when it lands; the prediction only ever
   decides how many days the current money is divided over.
   ============================================================ */

export type PayRule = { kind: "dom"; dom: number } | { kind: "lwd" };

export interface Credit {
  day: Day;
  amount: number;
  payer: string;
}

export interface Candidate {
  payer: string;
  count: number;
  /** Typical amount, in pence. */
  median: number;
  last: Day;
  /** From your own other bank: still pay, if you say so. */
  isSelf: boolean;
  /** Every gap between arrivals looks monthly. */
  regular: boolean;
}

export interface Payday {
  payer: string;
  /** You said so, rather than Nori working it out. */
  chosen: boolean;
  /** The most recent salary, in pence. */
  amount: number;
  /** Every salary found, oldest first. */
  days: Day[];
  amounts: number[];
  rule: PayRule;
}

export interface Cycle {
  start: Day;
  /** The last day before the next salary. */
  end: Day;
  nextPayday: Day;
  daysIn: number;
  /** Today is day N of daysIn, counting from 1. */
  dayIndex: number;
  /** Days still to get through, today included. Never zero. */
  daysLeft: number;
  basis: "salary" | "calendar";
  payer: string | null;
  /** The predicted payday has passed and the salary has not arrived. */
  late: boolean;
  rule: PayRule | null;
}

/** A salary is at least this much. Below it, a monthly credit is more
 *  likely a friend's standing order than a payslip. */
const MIN_SALARY = 30_000;
/** Three arrivals, and every recent gap has to look monthly. Two
 *  payments and a hopeful guess is how a cycle ends up anchored to a
 *  transfer somebody made themselves, once. */
const MIN_PAYDAYS = 3;
const GAP_MIN = 24, GAP_MAX = 38;
/** A salary that has not arrived in this long has stopped being one. */
const STALE_DAYS = 45;

function norm(payer: string): string {
  return payer.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function backToFriday(d: Day): Day {
  const w = weekday(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, -2) : d;
}

/** The date a rule puts payday on, in month m (0-11) of year y. */
export function payDate(rule: PayRule, y: number, m: number): Day {
  return backToFriday(rule.kind === "lwd" ? make(y, m, 31) : make(y, m, rule.dom));
}

export function describeRule(rule: PayRule | null): string {
  if (!rule) return "the calendar month";
  if (rule.kind === "lwd" || rule.dom === 31) return "the last working day of the month";
  const n = rule.dom;
  const th = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `the ${n}${th}, or the Friday before when it falls on a weekend`;
}

/** Which rule explains the most of these paydays. */
function explain(days: Day[]): PayRule {
  const tries: PayRule[] = [{ kind: "lwd" }];
  for (const d of days) {
    const dom = ymd(d).day;
    if (!tries.some((r) => r.kind === "dom" && r.dom === dom)) tries.push({ kind: "dom", dom });
    /* A Friday payday may be a weekend 25th moved back — try the
     * weekend dates it could stand in for as well. */
    if (weekday(d) === 5) for (const k of [1, 2]) {
      const alt = ymd(addDays(d, k)).day;
      if (!tries.some((r) => r.kind === "dom" && r.dom === alt)) tries.push({ kind: "dom", dom: alt });
    }
  }
  let best = tries[0], bestScore = -1;
  for (const r of tries) {
    const score = days.filter((d) => {
      const { y, m } = ymd(d);
      return payDate(r, y, m) === d;
    }).length;
    /* Ties go to a fixed date over "last working day": it is the
     * commoner payslip and the one a person would guess. */
    if (score > bestScore || (score === bestScore && r.kind === "dom" && best.kind === "lwd")) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The salary, if there is one.
 *
 * `self` is the name on the account: money moved in from your own
 * other bank is income, but it is not a payday, and a cycle anchored
 * to it lurches whenever you happen to top up.
 */
function group(credits: Credit[]): Map<string, Credit[]> {
  const groups = new Map<string, Credit[]>();
  for (const c of credits) {
    if (c.amount < MIN_SALARY) continue;
    const k = norm(c.payer);
    if (!k) continue;
    const g = groups.get(k) ?? [];
    g.push(c);
    groups.set(k, g);
  }
  for (const list of groups.values()) list.sort((a, b) => (a.day < b.day ? -1 : 1));
  return groups;
}

const monthlyGaps = (list: Credit[]) => list.slice(1).map((c, i) => diff(list[i].day, c.day)).slice(-4).every((g) => g >= GAP_MIN && g <= GAP_MAX);

/** Who pays you, biggest and most recent first, for you to choose from. */
export function payCandidates(credits: Credit[], self?: string | null): Candidate[] {
  const mine = self ? norm(self) : null;
  const out: Candidate[] = [];
  for (const [k, list] of group(credits)) {
    if (list.length < 2) continue;
    const amounts = list.map((c) => c.amount).sort((a, b) => a - b);
    out.push({
      payer: list[list.length - 1].payer,
      count: list.length,
      median: amounts[Math.floor(amounts.length / 2)],
      last: list[list.length - 1].day,
      isSelf: Boolean(mine && k === mine),
      regular: list.length >= MIN_PAYDAYS && monthlyGaps(list),
    });
  }
  return out.sort((a, b) => (b.last < a.last ? -1 : b.last > a.last ? 1 : b.median - a.median));
}

function payFrom(list: Credit[], chosen: boolean): Payday {
  const days = list.map((c) => c.day);
  return { payer: list[list.length - 1].payer, chosen, amount: list[list.length - 1].amount, days, amounts: list.map((c) => c.amount), rule: explain(days) };
}

/**
 * The pay, if it can be known.
 *
 * `chosen` is the payer you named in Settings, and it always wins.
 * Without it, only an obvious payslip counts: three or more arrivals,
 * every recent gap monthly, one of them recent, and not from your own
 * name — because a transfer from yourself is just as likely to be you
 * moving savings about. When nothing qualifies, Nori says it found
 * none and asks, rather than anchoring your month to a guess.
 */
export function detectPayday(credits: Credit[], today?: Day, self?: string | null, chosen?: string | null): Payday | null {
  const groups = group(credits);
  const mine = self ? norm(self) : null;
  if (chosen) {
    const list = groups.get(norm(chosen));
    if (list?.length) return payFrom(list, true);
  }
  let best: { payer: string; list: Credit[]; median: number } | null = null;
  for (const [k, list] of groups) {
    if (mine && k === mine) continue;
    if (list.length < MIN_PAYDAYS) continue;
    /* Every recent gap has to look monthly. Four monthly transfers
     * followed by six months of silence is not a payslip. */
    if (!monthlyGaps(list)) continue;
    if (today && diff(list[list.length - 1].day, today) > STALE_DAYS) continue;
    const sorted = list.map((c) => c.amount).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (!best || median > best.median) best = { payer: list[list.length - 1].payer, list, median };
  }
  return best ? payFrom(best.list, false) : null;
}

/** The first payday the rule predicts after `after`. */
export function nextPayDate(rule: PayRule, after: Day): Day {
  const { y, m } = ymd(after);
  for (let k = 0; k < 3; k++) {
    const d = payDate(rule, y, m + k);
    if (diff(after, d) >= 20) return d;
  }
  return payDate(rule, y, m + 2);
}

export function parseRuleSetting(s: string): PayRule | "calendar" | null {
  if (s === "calendar") return "calendar";
  if (s === "lwd") return { kind: "lwd" };
  const m = /^dom:(\d{1,2})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 31) return { kind: "dom", dom: +m[1] };
  return null;
}

function calendar(today: Day): Cycle {
  const { y, m } = ymd(today);
  const start = make(y, m, 1);
  const next = make(y, m + 1, 1);
  const end = addDays(next, -1);
  const daysIn = diff(start, end) + 1;
  const dayIndex = diff(start, today) + 1;
  return { start, end, nextPayday: next, daysIn, dayIndex, daysLeft: daysIn - dayIndex + 1, basis: "calendar", payer: null, late: false, rule: null };
}

/**
 * The cycle `today` falls in.
 *
 * `setting` is the Settings choice: "auto" follows the detected rule,
 * "dom:N" / "lwd" overrides only the prediction (the salary still has
 * to be found to know when the cycle started), "calendar" opts out.
 */
export function cycleFor(today: Day, pay: Payday | null, setting = "auto"): Cycle {
  const choice = parseRuleSetting(setting);
  if (choice === "calendar" || !pay) return calendar(today);
  const landed = pay.days.filter((d) => d <= today);
  if (!landed.length) return calendar(today);
  const start = landed[landed.length - 1];
  const rule = choice ?? pay.rule;
  const next = nextPayDate(rule, start);
  let end = addDays(next, -1);
  const late = today > end;
  if (late) end = today;
  const daysIn = diff(start, end) + 1;
  const dayIndex = diff(start, today) + 1;
  return { start, end, nextPayday: late ? addDays(today, 1) : next, daysIn, dayIndex, daysLeft: daysIn - dayIndex + 1, basis: "salary", payer: pay.payer, late, rule };
}

/** Earlier cycles, newest first, bounded by consecutive salaries. */
export function pastCycles(pay: Payday | null, current: Cycle, count: number): { start: Day; end: Day }[] {
  if (!pay || current.basis === "calendar") {
    const out: { start: Day; end: Day }[] = [];
    let start = current.start;
    for (let i = 0; i < count; i++) {
      const { y, m } = ymd(start);
      const s = make(y, m - 1, 1);
      out.push({ start: s, end: addDays(start, -1) });
      start = s;
    }
    return out;
  }
  const days = pay.days.filter((d) => d < current.start);
  const out: { start: Day; end: Day }[] = [];
  for (let i = days.length - 1; i >= 0 && out.length < count; i--) {
    const end = addDays(i === days.length - 1 ? current.start : days[i + 1], -1);
    out.push({ start: days[i], end });
  }
  return out;
}
