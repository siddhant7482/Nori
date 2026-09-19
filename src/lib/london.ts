/* ============================================================
   Days, in London.

   A day in Nori is a London calendar day, written "YYYY-MM-DD". A
   coffee at 00:30 on the 1st belongs to the 1st even though it is
   23:30 on the 31st in UTC for half the year, and a payday cycle that
   got that wrong would put a payment in the wrong month.

   Arithmetic on day keys is done at UTC noon, where adding a day can
   never be knocked sideways by a clock change.
   ============================================================ */

export type Day = string;

const LONDON = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayOf(d: Date): Day {
  return LONDON.format(d);
}

/** Today in London. NORI_TODAY pins it, for the example cycle only. */
export function today(): Day {
  const pinned = process.env.NORI_TODAY;
  return pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : dayOf(new Date());
}

function noon(d: Day): Date {
  return new Date(d + "T12:00:00Z");
}

export function key(d: Date): Day {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Day, n: number): Day {
  const x = noon(d);
  x.setUTCDate(x.getUTCDate() + n);
  return key(x);
}

/** Whole days from a to b: diff("2026-09-01", "2026-09-03") === 2. */
export function diff(a: Day, b: Day): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000);
}

/** 0 = Sunday. */
export function weekday(d: Day): number {
  return noon(d).getUTCDay();
}

export function ymd(d: Day): { y: number; m: number; day: number } {
  return { y: +d.slice(0, 4), m: +d.slice(5, 7) - 1, day: +d.slice(8, 10) };
}

export function make(y: number, m: number, day: number): Day {
  const x = new Date(Date.UTC(y, m, 1, 12));
  const last = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return key(x);
}

/** "12 Sep" */
export function short(d: Day): string {
  const { m, day } = ymd(d);
  return day + " " + MON[m];
}

/** "Sat 12 Sep" */
export function withDay(d: Day): string {
  return WK[weekday(d)] + " " + short(d);
}

export function monthName(m: number, full = false): string {
  return (full ? FULL_MON : MON)[((m % 12) + 12) % 12];
}

export function weekdayName(d: Day): string {
  return WK[weekday(d)];
}
