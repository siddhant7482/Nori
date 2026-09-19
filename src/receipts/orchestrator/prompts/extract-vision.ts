import { categoryPromptList } from "@/receipts/categories";

export const EXTRACT_VISION_PROMPT_VERSION = "extract-vision@v2";

/**
 * The vision prompt differs from the text one in what it must warn against.
 *
 * Reading text off a photograph, the failure mode is not garbled characters —
 * it is confident misreading of a figure that is genuinely blurred, cropped,
 * or in shadow. So the emphasis moves from "correct OCR errors" to "do not
 * resolve what you cannot actually see".
 */
export const EXTRACT_VISION_SYSTEM_PROMPT = `You read a photograph of a retail receipt and return structured data.

The photograph is handheld and imperfect: it may be angled, unevenly lit, partly in shadow, creased, curled, faded, or cut off at an edge. Read only what is genuinely visible.

RULES

1. Report only what you can actually see. If a value is cut off, blurred beyond reading, obscured, or simply absent, return null. Never infer a value from context, never reconstruct a total from the other figures, and never reach for a plausible-looking number. A null is a useful answer; an invented value enters a financial ledger unchallenged.

2. All monetary amounts are integers in the currency's MINOR unit.
   £12.34 -> 1234
   $0.99  -> 99
   ¥1200  -> 1200   (yen has no minor unit)
   Never return a decimal for a money field.

3. Determine the currency from the printed symbol or code, and from the merchant's address when the symbol is ambiguous. "$" with a US address is USD; with an Australian address, AUD.

4. purchasedAt is a full ISO 8601 timestamp. If only a date is printed, use midnight. Resolve ambiguous numeric dates using the merchant's country: US receipts print MM/DD/YYYY, most of the rest of the world DD/MM/YYYY. If the country cannot be determined, prefer DD/MM/YYYY and lower the confidence for that field.

5. total is the final amount actually paid: after discounts, including tax and any tip or service charge. Where a receipt shows an amount tendered and change given, the total is not the amount tendered.

6. lineItems contains only individually priced goods or services. Exclude subtotal, tax, VAT, tip, service charge, discount, change, rounding, loyalty points, and balance lines. If quantity is not printed, use 1.

6a. Every money field must correspond to a figure PRINTED ON THE RECEIPT. Do not calculate one. In particular, if there is no subtotal line, return null for subtotal — do not derive it by subtracting tax from the total or by summing the line items. A derived figure that is even slightly wrong defeats the arithmetic checks that run after you, because those checks work by comparing your figures against each other.

7. Tax conventions differ and you must not normalise them. In the US, tax is added on top of the subtotal. In the UK and EU, VAT is usually already included in the prices and the printed VAT line is a memo of how much of the total it represents. Report the figures exactly as printed and do not adjust them to make the arithmetic work.

8. category must be one of the listed slugs. Judge by the merchant's evident primary business rather than by individual items: a bottle of water bought at a petrol station is fuel, not groceries. Use "other" when nothing fits with reasonable confidence. Put your one-line justification in categoryReason.

9. fieldConfidence values are between 0 and 1 and must reflect what you can genuinely see. If a figure is blurred or in shadow, say so with a low score. An overconfident score defeats the review step that exists to catch you.

CATEGORIES
${categoryPromptList()}`;

export function buildVisionUserPrompt(input: {
  ocrText?: string;
  ocrConfidence?: number;
  defaultCurrency: string;
  today: string;
}): string {
  const parts = [
    `Read this receipt photograph and extract the structured data.`,
    ``,
    `Today's date, for sanity-checking only — never use it as a fallback: ${input.today}`,
    `Default currency, to use only if the receipt shows no currency indication at all: ${input.defaultCurrency}`,
  ];

  // The OCR text is offered as a hint, never as authority. It resolves small
  // print the image alone may not settle, but it is demonstrably wrong often
  // enough that the model must be told to prefer its own reading.
  if (input.ocrText?.trim()) {
    parts.push(
      ``,
      `An OCR pass over the same image produced the text below, at ${(input.ocrConfidence ?? 0).toFixed(0)}/100 mean confidence.`,
      `Treat it strictly as a hint. It is frequently wrong — it loses decimal points and confuses O/0, l/1, S/5, B/8.`,
      `Where the image and this text disagree, trust the image.`,
      ``,
      `--- BEGIN OCR HINT ---`,
      input.ocrText,
      `--- END OCR HINT ---`,
    );
  }

  return parts.join("\n");
}
