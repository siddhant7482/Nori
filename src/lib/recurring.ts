import { addDays, diff, make, short, weekday, ymd, type Day } from "./london";

/* ============================================================
   WHAT COMES BACK, AND WHAT IS STILL DUE.

   Rent, the council tax, Netflix: money that has already been
   decided. The daily number is a lie while it ignores them, because
   "£2.95 a day" is not £2.95 a day if £950 of rent has yet to leave.

   Nothing is typed in here either. A recurring payment is found the
   way a person would: the same payee, at the same sort of interval,
   for about the same amount, at least three times.

   The "about the same amount" part does real work. One payee often
   has two lives: a £35.70 travel pass every four weeks AND £5 top-ups
   whenever; £10 of phone credit every month AND £3 in an emergency.
   Lumped together the amounts look random and the pass is lost, so
   payments are grouped by payee AND by amount before anything else. From that come
   three things Nori can say without being asked:

     · what is still due before payday
     · that a bill changed amount, with the old figure and the new
     · that the same shop charged the same amount twice in an hour

   Where it is unsure it says nothing. A wrong "still due" would make
   the one number this app exists for wrong in the other direction.
   ============================================================ */

export type Cadence = "weekly" | "fortnightly" | "four-weekly" | "monthly" | "yearly";

export interface RecurIn {
  id: string;
  day: Day;
  created: Date;
  amount: number;
  kind: string;
  categoryId: string | null;
  description: string;
  merchantGroupId: string | null;
  merchantName: string | null;
  counterpartyName: string | null;
}

export interface Series {
  /** The payee. One payee can have several series. */
  key: string;
  /** Payee plus the amount it recurs at: unique per series. */
  id: string;
  label: string;
  categoryId: string | null;
  cadence: Cadence;
  /** Median days between payments. */
  every: number;
  /** What it usually costs, in pence, positive. */
  typical: number;
  last: { day: Day; amount: number };
  seen: number;
  /** When the next one is expected. */
  due: Day;
  /** Set when the most recent payment broke the pattern. */
  changed: { from: number; to: number; at: Day; pct: number } | null;
}

export interface Due {
  series: Series;
  due: Day;
  amount: number;
  /** Expected before today and still not seen. */
  overdue: boolean;
}

const MIN_SEEN = 3;
/** Under this, a "bill" is noise: a coffee subscription is not the
 *  reason the daily number is wrong. */
const MIN_AMOUNT = 300;

const CADENCES: { cadence: Cadence; days: number; slack: number }[] = [
  { cadence: "weekly", days: 7, slack: 2 },
  { cadence: "fortnightly", days: 14, slack: 3 },
  { cadence: "four-weekly", days: 28, slack: 2 },
  { cadence: "monthly", days: 30.44, slack: 4 },
  { cadence: "yearly", days: 365, slack: 10 },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function keyOf(t: RecurIn): string {
  return t.merchantGroupId ?? (t.counterpartyName ?? t.description).toUpperCase().replace(/\s+/g, " ").trim();
}

function labelOf(t: RecurIn): string {
  return t.merchantName ?? t.counterpartyName ?? t.description;
}

/** The same day of the month each time means a monthly bill, even when
 *  the gaps wobble between 28 and 31 days. */
function monthlyByDate(days: Day[]): boolean {
  const doms = days.map((d) => ymd(d).day);
  const hi = Math.max(...doms), lo = Math.min(...doms);
  return hi - lo <= 3 || (hi >= 27 && lo <= 3);
}

function nextAfter(days: Day[], cadence: Cadence, every: number): Day {
  const last = days[days.length - 1];
  if (cadence !== "monthly") return addDays(last, Math.round(every));
  /* Monthly bills land on a date, not an interval: the 3rd is the 3rd
   * even when February is short. Weekend dates are left alone — a
   * direct debit taken on the Monday is still the same bill. */
  const dom = median(days.map((d) => ymd(d).day));
  const { y, m } = ymd(last);
  for (let k = 1; k <= 2; k++) {
    const d = make(y, m + k, dom);
    if (diff(last, d) >= 20) return d;
  }
  return addDays(last, 30);
}

/**
 * Every recurring payment in `txs`, as at `today`.
 *
 * `txs` should cover at least a year: three occurrences is the floor
 * for calling something recurring, and a yearly bill needs the room.
 */
export function findRecurring(txs: RecurIn[], today: Day): Series[] {
  const groups = new Map<string, RecurIn[]>();
  for (const t of txs) {
    if (t.kind !== "spend" || -t.amount < MIN_AMOUNT) continue;
    const k = keyOf(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  const out: Series[] = [];
  for (const [key, list] of groups)
    for (const cluster of byAmount(list)) {
      const one = series(key, cluster, today);
      if (one) out.push(one);
    }
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : b.typical - a.typical));
}

/** Payments of about the same size, kept together.
 *
 *  A price rise would otherwise split one bill in two and lose it: the
 *  three payments of £10.99 stay a series, the one of £12.99 is too
 *  few to be anything. So a small, LATER group folds back into the
 *  group it grew out of, and the amount test in series() decides
 *  whether that still counts as the same bill. */
function byAmount(list: RecurIn[]): RecurIn[][] {
  const clusters: { med: number; items: RecurIn[] }[] = [];
  for (const t of [...list].sort((a, b) => b.amount - a.amount)) {
    const a = -t.amount;
    const c = clusters.find((c) => Math.abs(a - c.med) <= Math.max(100, c.med * 0.12));
    if (c) {
      c.items.push(t);
      c.med = median(c.items.map((x) => -x.amount));
    } else clusters.push({ med: a, items: [t] });
  }
  const first = (c: { items: RecurIn[] }) => c.items.reduce((d, t) => (t.day < d ? t.day : d), c.items[0].day);
  const last = (c: { items: RecurIn[] }) => c.items.reduce((d, t) => (t.day > d ? t.day : d), c.items[0].day);
  for (const small of clusters.filter((c) => c.items.length < MIN_SEEN)) {
    const host = clusters.find((c) => c !== small && c.items.length >= MIN_SEEN && last(c) < first(small) && Math.abs(small.med - c.med) <= c.med * 0.6);
    if (!host) continue;
    host.items.push(...small.items);
    small.items = [];
  }
  return clusters.filter((c) => c.items.length >= MIN_SEEN).map((c) => c.items);
}

function series(key: string, list: RecurIn[], today: Day): Series | null {
  {
    list.sort((a, b) => (a.day < b.day ? -1 : 1));
    /* Two charges on one day are one event to a schedule (and a
     * "double charge" to the check below). */
    const byDay: RecurIn[] = [];
    for (const t of list) if (!byDay.length || byDay[byDay.length - 1].day !== t.day) byDay.push(t);
    if (byDay.length < MIN_SEEN) return null;

    const days = byDay.map((t) => t.day);
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push(diff(days[i - 1], days[i]));
    const every = median(gaps);
    const dated = monthlyByDate(days);
    const fit = CADENCES.find((c) => (dated && c.cadence === "monthly" ? Math.abs(every - c.days) <= 6 : Math.abs(every - c.days) <= c.slack));
    if (!fit) return null;
    /* Every gap has to fit, or it is a shop you happen to visit
     * regularly rather than a bill. */
    if (!gaps.every((g) => Math.abs(g - every) <= (fit.cadence === "monthly" ? 6 : fit.slack + 1))) return null;

    const amounts = byDay.map((t) => -t.amount);
    const typical = median(amounts);
    if (!amounts.every((a) => Math.abs(a - typical) <= Math.max(200, typical * 0.2))) return null;

    /* Cancelled: it should have come back by now and did not. */
    const last = byDay[byDay.length - 1];
    if (diff(last.day, today) > every * 1.8 + 5) return null;

    const before = amounts.slice(0, -1);
    const prev = median(before);
    const lastAmount = amounts[amounts.length - 1];
    const delta = lastAmount - prev;
    const changed = Math.abs(delta) >= Math.max(50, prev * 0.02) ? { from: prev, to: lastAmount, at: last.day, pct: Math.round((delta / prev) * 100) } : null;

    return {
      key,
      id: `${key}|${typical}`,
      label: labelOf(last),
      categoryId: last.categoryId,
      cadence: fit.cadence,
      every,
      typical: changed ? lastAmount : typical,
      last: { day: last.day, amount: lastAmount },
      seen: byDay.length,
      due: nextAfter(days, fit.cadence, every),
      changed,
    };
  }
}

/**
 * What is still to leave between `today` and `end`, inclusive.
 *
 * A payment expected before today that has not arrived stays on the
 * list as overdue: a rent that is three days late is still rent.
 */
export function stillDue(series: Series[], today: Day, end: Day): Due[] {
  const out: Due[] = [];
  for (const s of series) {
    /* `due` is always after the last payment seen, so a due date in
     * the past means it has not arrived. More than ten days late and
     * Nori stops counting on it rather than holding money back for a
     * bill that may never come. */
    const overdue = s.due <= today;
    if (overdue && diff(s.due, today) > 10) continue;
    if (!overdue && s.due > end) continue;
    /* A weekly payment can fall due several times before payday, and
     * every one of them is money that is already gone. */
    let when = overdue ? today : s.due;
    for (let i = 0; i < 6 && when <= end; i++) {
      out.push({ series: s, due: when, amount: s.typical, overdue: overdue && i === 0 });
      when = addDays(overdue && i === 0 ? s.due : when, Math.max(1, Math.round(s.every)));
    }
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : b.amount - a.amount));
}

export const dueTotal = (due: Due[]): number => due.reduce((n, d) => n + d.amount, 0);

/** The same shop, the same amount, twice within two hours. */
export interface DoubleCharge {
  label: string;
  day: Day;
  amount: number;
  ids: string[];
}

export function doubleCharges(txs: RecurIn[], from: Day): DoubleCharge[] {
  const seen = new Map<string, RecurIn[]>();
  for (const t of txs) {
    if (t.kind !== "spend" || t.day < from || -t.amount < MIN_AMOUNT) continue;
    const k = `${keyOf(t)}|${t.amount}|${t.day}`;
    seen.set(k, [...(seen.get(k) ?? []), t]);
  }
  const out: DoubleCharge[] = [];
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.created.getTime() - b.created.getTime());
    const close = list.filter((t, i) => i > 0 && t.created.getTime() - list[i - 1].created.getTime() < 2 * 3600_000);
    if (!close.length) continue;
    out.push({ label: labelOf(list[0]), day: list[0].day, amount: -list[0].amount, ids: list.map((t) => t.id) });
  }
  return out.sort((a, b) => (a.day > b.day ? -1 : 1));
}

export function describeCadence(s: Series): string {
  if (s.cadence === "monthly") {
    const d = ymd(s.last.day).day;
    return `monthly, around the ${d}${d === 1 || d === 21 || d === 31 ? "st" : d === 2 || d === 22 ? "nd" : d === 3 || d === 23 ? "rd" : "th"}`;
  }
  if (s.cadence === "yearly") return `yearly, around ${short(s.last.day)}`;
  if (s.cadence === "weekly") return `weekly, on a ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(s.last.day)]}`;
  return s.cadence === "fortnightly" ? "every two weeks" : "every four weeks";
}
