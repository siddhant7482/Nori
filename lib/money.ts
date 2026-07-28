/**
 * The single chokepoint for money.
 *
 * INVARIANT: every monetary amount in this codebase is an integer in the
 * currency's minor unit, paired with an ISO-4217 code. £12.34 is `1234` +
 * `"GBP"`. There are no floats and no `Decimal`s above the database layer.
 *
 * Floats lose cents silently — `0.1 + 0.2 !== 0.3` — and in a ledger that
 * corruption is unrecoverable once the rows exist. Keeping every conversion
 * in one file is what makes the invariant enforceable rather than aspirational.
 */

export type Money = {
  /** Integer, in minor units. */
  readonly amount: number;
  /** ISO-4217, uppercase. */
  readonly currency: string;
};

/** Currencies whose minor unit is not 1/100. Everything else is 2. */
const EXPONENTS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function minorUnitExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount)) {
    throw new TypeError(
      `Money must be an integer in minor units, received ${amount}. ` +
        `Use toMinor() to convert a decimal amount.`,
    );
  }
  return { amount, currency: currency.toUpperCase() };
}

/** 12.34 GBP -> 1234. Rounds half-away-from-zero at the minor unit. */
export function toMinor(major: number, currency: string): number {
  const factor = 10 ** minorUnitExponent(currency);
  // Math.round is biased toward +Infinity on .5, which would round -0.005
  // the wrong way for refunds and negative adjustments.
  const scaled = major * factor;
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/** 1234 GBP -> 12.34. For display and export only — never arithmetic. */
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** minorUnitExponent(currency);
}

/**
 * Parse user or OCR input into minor units.
 *
 * Handles the formats a receipt or a keyboard actually produces: currency
 * symbols, thousands separators in either convention, and trailing minus or
 * parenthesised negatives. Returns null rather than guessing when the input
 * is not a number — a silent 0 would post a wrong row to the ledger.
 */
export function parseMoney(input: string, currency: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  const negative = /^\(.*\)$/.test(raw) || /-\s*$|^\s*-/.test(raw);
  let s = raw.replace(/[()\s]/g, "").replace(/[^\d.,-]/g, "").replace(/-/g, "");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal point: 1.234,56 vs 1,234.56
    const decimalSep = lastDot > lastComma ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    s = s.split(groupSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // A lone comma is a decimal separator only if it isn't grouping digits.
    const tail = s.length - lastComma - 1;
    s = tail === 3 && !/^0/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return toMinor(negative ? -value : value, currency);
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string, opts: Intl.NumberFormatOptions) {
  const key = `${locale}|${currency}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency, ...opts });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(
  minor: number,
  currency: string,
  { locale = "en-GB", compact = false }: { locale?: string; compact?: boolean } = {},
): string {
  const code = currency.toUpperCase();
  return formatter(
    code,
    locale,
    compact ? { notation: "compact", maximumFractionDigits: 1 } : {},
  ).format(toMajor(minor, code));
}

/** Symbol + digits only, for dense table cells where the column is labelled. */
export function formatAmount(
  minor: number,
  currency: string,
  locale = "en-GB",
): string {
  const code = currency.toUpperCase();
  const digits = minorUnitExponent(code);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajor(minor, code));
}

export function sumMoney(amounts: readonly number[]): number {
  return amounts.reduce((a, b) => a + b, 0);
}

/**
 * Tolerant equality for reconciliation (§7.4 of the spec).
 *
 * Receipts round line items and totals independently, so a legitimate receipt
 * can be off by a minor unit or two. `tolerance` is in minor units.
 */
export function amountsReconcile(
  a: number,
  b: number,
  tolerance = 2,
): boolean {
  return Math.abs(a - b) <= tolerance;
}
