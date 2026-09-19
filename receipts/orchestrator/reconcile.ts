import { amountsReconcile, formatMoney, sumMoney } from "@/lib/money";
import type { ExtractedReceipt } from "./schemas";

/**
 * Deterministic validation of an extraction. No model involved.
 *
 * Arithmetic is not the model's job, and this is not a redundant safety net:
 * it catches precisely the errors a model is most *confident* about — a
 * cleanly misread decimal point produces a total that looks entirely
 * reasonable in isolation and only fails against the other figures on the
 * page. Those are exactly the errors a human reviewer skims past.
 */

export type WarningField =
  | "total"
  | "subtotal"
  | "taxTotal"
  | "lineItems"
  | "purchasedAt"
  | "currency"
  | "merchantName"
  | "category";

export type ReconcileWarning = {
  field: WarningField;
  message: string;
  /** `error` blocks confident auto-fill; `warn` only flags for review. */
  severity: "error" | "warn";
};

export type ReconcileResult = {
  warnings: ReconcileWarning[];
  needsReview: boolean;
  /** Mean of the model's own field confidences, 0-1. */
  meanConfidence: number;
};

/** Receipts round line items and totals independently — allow a couple of units. */
const TOLERANCE = 2;

/** Below this the extraction is flagged regardless of arithmetic. */
const CONFIDENCE_FLOOR = 0.7;

export function reconcile(r: ExtractedReceipt): ReconcileResult {
  const warnings: ReconcileWarning[] = [];
  const currency = r.currency ?? "GBP";
  const fmt = (n: number) => formatMoney(n, currency);

  // ---- Required essentials -------------------------------------------------
  if (r.total === null) {
    warnings.push({
      field: "total",
      message: "No total could be read from this receipt.",
      severity: "error",
    });
  } else if (r.total <= 0) {
    warnings.push({
      field: "total",
      message: `Total reads ${fmt(r.total)}, which is not a valid purchase amount.`,
      severity: "error",
    });
  }

  if (!r.merchantName?.trim()) {
    warnings.push({
      field: "merchantName",
      message: "No merchant name could be read.",
      severity: "warn",
    });
  }

  if (!r.currency) {
    warnings.push({
      field: "currency",
      message: `No currency printed on the receipt — assuming ${currency}.`,
      severity: "warn",
    });
  }

  // ---- Line items vs subtotal ---------------------------------------------
  if (r.lineItems.length > 0 && r.subtotal !== null) {
    const itemSum = sumMoney(r.lineItems.map((i) => i.total));
    if (!amountsReconcile(itemSum, r.subtotal, TOLERANCE)) {
      warnings.push({
        field: "lineItems",
        message: `Line items sum to ${fmt(itemSum)} but the subtotal reads ${fmt(r.subtotal)}.`,
        severity: "warn",
      });
    }
  }

  // ---- Subtotal + tax + tip vs total --------------------------------------
  //
  // Two conventions exist and a receipt does not say which it follows:
  //
  //   additive  (US sales tax)  subtotal + tax + tip == total
  //   inclusive (UK/EU VAT)     subtotal + tip == total, tax is a memo of how
  //                             much of that total was already VAT
  //
  // Testing only the additive form would fire on essentially every British
  // receipt. A warning that is usually wrong is worse than no warning: it
  // trains the user to dismiss the one that matters.
  if (r.total !== null && r.subtotal !== null) {
    const tip = r.tipTotal ?? 0;
    const additive = r.subtotal + (r.taxTotal ?? 0) + tip;
    const inclusive = r.subtotal + tip;

    const ok =
      amountsReconcile(additive, r.total, TOLERANCE) ||
      amountsReconcile(inclusive, r.total, TOLERANCE);

    if (!ok) {
      // Report against whichever convention is closer, so the numbers quoted
      // back to the user are the ones they can actually check on the paper.
      const computed =
        Math.abs(additive - r.total) <= Math.abs(inclusive - r.total)
          ? additive
          : inclusive;
      const label = computed === additive ? "Subtotal plus tax" : "Subtotal";

      const ratio = computed > 0 ? r.total / computed : 0;
      // A clean factor of ten is a misread decimal point, not a maths error.
      // Naming the likely cause turns a vague warning into a one-glance fix.
      const decimalSlip =
        computed > 0 && (isNear(ratio, 10) || isNear(ratio, 0.1));

      warnings.push({
        field: "total",
        message: decimalSlip
          ? `${label} is ${fmt(computed)}, but the total reads ${fmt(r.total)} — the decimal point is likely misread.`
          : `${label} is ${fmt(computed)}, but the total reads ${fmt(r.total)}.`,
        severity: "warn",
      });
    }
  }

  // ---- Date sanity ---------------------------------------------------------
  if (!r.purchasedAt) {
    warnings.push({
      field: "purchasedAt",
      message: "No purchase date could be read.",
      severity: "warn",
    });
  } else {
    const d = new Date(r.purchasedAt);
    if (Number.isNaN(d.getTime())) {
      warnings.push({
        field: "purchasedAt",
        message: `"${r.purchasedAt}" is not a valid date.`,
        severity: "error",
      });
    } else {
      // One day of slack absorbs receipts timestamped in a timezone ahead of
      // the server's, which is otherwise a constant source of false flags.
      const tomorrow = Date.now() + 86_400_000;
      if (d.getTime() > tomorrow) {
        warnings.push({
          field: "purchasedAt",
          message: `Purchase date ${d.toISOString().slice(0, 10)} is in the future.`,
          severity: "warn",
        });
      } else if (d.getUTCFullYear() < 2000) {
        warnings.push({
          field: "purchasedAt",
          message: `Purchase date ${d.toISOString().slice(0, 10)} is implausibly old — the year was probably misread.`,
          severity: "warn",
        });
      }
    }
  }

  if (!r.category) {
    warnings.push({
      field: "category",
      message: "No category could be assigned with confidence.",
      severity: "warn",
    });
  }

  // ---- Model self-reported confidence -------------------------------------
  const c = r.fieldConfidence;
  const meanConfidence =
    (c.merchantName + c.purchasedAt + c.total + c.lineItems) / 4;

  for (const [field, value] of [
    ["merchantName", c.merchantName],
    ["purchasedAt", c.purchasedAt],
    ["total", c.total],
  ] as const) {
    if (value < CONFIDENCE_FLOOR) {
      warnings.push({
        field,
        message: `The model was only ${Math.round(value * 100)}% confident about this field.`,
        severity: "warn",
      });
    }
  }

  return {
    warnings,
    // NEEDS_REVIEW is the normal terminal state of automated processing —
    // the pipeline never auto-confirms, so this is currently always true.
    // It stays computed rather than hard-coded so that an opt-in auto-confirm
    // for clean, high-confidence receipts is a one-line change later.
    needsReview: true,
    meanConfidence,
  };
}

function isNear(value: number, target: number, tolerance = 0.02): boolean {
  return Math.abs(value - target) < target * tolerance;
}

export function confidenceLevel(v: number): "high" | "medium" | "low" {
  if (v >= 0.85) return "high";
  if (v >= 0.6) return "medium";
  return "low";
}
