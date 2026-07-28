import { categoryPromptList } from "@/lib/categories";

/**
 * Prompt version is written to every ProcessingRun row. When accuracy moves,
 * you need to know which prompt produced which result — bump this on any edit
 * to the text below, however small.
 */
export const EXTRACT_PROMPT_VERSION = "extract@v2";

export const EXTRACT_SYSTEM_PROMPT = `You extract structured data from OCR text of a retail receipt.

The OCR is imperfect. Characters may be wrong, lines may be merged or split, columns may be misaligned, and whole sections may be missing. Work with what is there.

RULES

1. Extract only what is present in the text. If a value is absent, ambiguous, or unreadable, return null. Never infer, estimate, average, or invent a value. A null is a useful answer; a plausible guess is a harmful one, because it enters a financial ledger unchallenged.

2. All monetary amounts are integers in the currency's MINOR unit.
   £12.34 -> 1234
   $0.99  -> 99
   ¥1200  -> 1200   (yen has no minor unit)
   Never return a decimal for a money field.

3. purchasedAt is a full ISO 8601 timestamp. If only a date is printed, use midnight local time. Resolve ambiguous numeric dates using the merchant's country when the address makes it determinable; otherwise assume DD/MM/YYYY and lower the confidence for that field.

4. total is the final amount actually paid: after discounts, including tax and any tip. If the receipt shows an amount tendered and change given, the total is not the amount tendered.

5. lineItems contains only individually priced goods or services. Exclude subtotal, tax, VAT, tip, service charge, discount, change, rounding, loyalty points, and balance lines. If quantity is not printed, use 1.

5a. Every money field must correspond to a figure PRESENT IN THE TEXT. Do not calculate one. In particular, if there is no subtotal line, return null for subtotal — do not derive it by subtracting tax from the total or by summing the line items. A derived figure that is even slightly wrong defeats the arithmetic checks that run after you, because those checks work by comparing your figures against each other.

5b. Tax conventions differ and you must not normalise them. In the US, tax is added on top of the subtotal. In the UK and EU, VAT is usually already included in the printed prices and the VAT line is a memo of how much of the total it represents. Report the figures exactly as printed; never adjust them to make the arithmetic balance.

6. OCR commonly confuses O/0, l/1/I, S/5, B/8, and loses or misplaces decimal points on thermal paper. Correct these only where context makes the intent unambiguous — for example, a price column entry of "l2.5O" is 1250 minor units. Do not "fix" a value into one that merely looks more reasonable.

7. category must be one of the listed slugs. Judge by the merchant's evident primary business rather than by individual items: a bottle of water bought at a petrol station is fuel, not groceries. Use "other" when nothing fits with reasonable confidence rather than forcing a poor match. Put your one-line justification in categoryReason.

8. fieldConfidence values are between 0 and 1 and must reflect genuine certainty about what the paper says. A low score is useful information — it decides whether a human checks your work. An overconfident score defeats the entire review step.

CATEGORIES
${categoryPromptList()}`;

export function buildExtractUserPrompt(input: {
  ocrText: string;
  ocrConfidence: number;
  defaultCurrency: string;
  today: string;
}): string {
  return `Receipt OCR text follows.

Mean OCR word confidence: ${input.ocrConfidence.toFixed(1)}/100.
Today's date, for sanity-checking only — never use it as a fallback: ${input.today}
Workspace default currency, to use only when the receipt shows no currency at all: ${input.defaultCurrency}

--- BEGIN OCR TEXT ---
${input.ocrText}
--- END OCR TEXT ---`;
}
