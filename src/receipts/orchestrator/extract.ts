import { env } from "@/receipts/env";
import { llm, LLMResponseError, readUsage, type Usage } from "./client";
import {
  ExtractedReceiptSchema,
  EXTRACTED_RECEIPT_JSON_SCHEMA,
  type ExtractedReceipt,
} from "./schemas";
import {
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
} from "./prompts/extract";

export type ExtractResult = {
  receipt: ExtractedReceipt;
  usage: Usage;
  promptVersion: string;
  /** Verbatim model output, kept for debugging a bad extraction. */
  raw: string;
};

/** OCR of a long supermarket receipt can run away; keep the request bounded. */
const MAX_OCR_CHARS = 24_000;

function clampOcrText(text: string): string {
  if (text.length <= MAX_OCR_CHARS) return text;
  // Keep the head and tail: the merchant sits at the top and the totals at
  // the bottom, so the middle line items are the only safe thing to drop.
  const half = Math.floor(MAX_OCR_CHARS / 2);
  return `${text.slice(0, half)}\n\n[... ${text.length - MAX_OCR_CHARS} characters of line items omitted ...]\n\n${text.slice(-half)}`;
}

export async function extractReceipt(input: {
  ocrText: string;
  ocrConfidence: number;
  defaultCurrency?: string;
  signal?: AbortSignal;
}): Promise<ExtractResult> {
  const model = env.OPENROUTER_EXTRACT_MODEL;
  const started = Date.now();

  const completion = await llm().chat.completions.create(
    {
      model,
      // Extraction is not a creative task. Any sampling temperature above zero
      // buys nothing and makes the fixture suite non-reproducible.
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildExtractUserPrompt({
            ocrText: clampOcrText(input.ocrText),
            ocrConfidence: input.ocrConfidence,
            defaultCurrency: input.defaultCurrency ?? "GBP",
            today: new Date().toISOString().slice(0, 10),
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_receipt",
          strict: true,
          schema: EXTRACTED_RECEIPT_JSON_SCHEMA,
        },
      },
    },
    { signal: input.signal },
  );

  const latencyMs = Date.now() - started;
  const raw = completion.choices[0]?.message?.content ?? "";

  if (!raw.trim()) {
    throw new LLMResponseError(
      `Model ${model} returned an empty response. If this is persistent, the model may not support strict json_schema output.`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new LLMResponseError(
      `Model ${model} returned content that is not valid JSON.`,
      raw,
    );
  }

  // Strict mode should guarantee shape, but "should" is not a guarantee across
  // every model OpenRouter can route to — validate rather than trust.
  const parsed = ExtractedReceiptSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new LLMResponseError(
      `Model ${model} returned JSON that does not match the schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      raw,
    );
  }

  return {
    receipt: parsed.data,
    usage: readUsage(model, latencyMs, completion.usage),
    promptVersion: EXTRACT_PROMPT_VERSION,
    raw,
  };
}
