/* ============================================================
   Integer pence until the moment it is drawn. Nothing here does
   arithmetic on money; it only prints it. (src/lib/money.ts, from
   the receipt engine, is the parser.)
   ============================================================ */

export function plain(p: number): string {
  return (Math.abs(p) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** -1234 -> "-£12.34" */
export function gbp(p: number): string {
  return (p < 0 ? "-" : "") + "£" + plain(p);
}

/** 123456 -> "£1,235". For chart labels, where pence are noise. */
export function round(p: number): string {
  return (p < 0 ? "-" : "") + "£" + Math.round(Math.abs(p) / 100).toLocaleString("en-GB");
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** Small counts read better as words in a sentence: "twelve days". */
export function words(n: number): string {
  return WORDS[n] ?? String(n);
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function nth(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + "th";
  return n + (n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th");
}

export function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}

export function list(names: string[]): string {
  return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
