import { env } from "@/receipts/env";
import { prepareForVision } from "@/receipts/ocr/preprocess";
import { llm, LLMResponseError, readUsage } from "./client";
import {
  ExtractedReceiptSchema,
  EXTRACTED_RECEIPT_JSON_SCHEMA,
} from "./schemas";
import {
  EXTRACT_VISION_PROMPT_VERSION,
  EXTRACT_VISION_SYSTEM_PROMPT,
  buildVisionUserPrompt,
} from "./prompts/extract-vision";
import type { ExtractResult } from "./extract";

/**
 * Extraction directly from the image, bypassing OCR as the source of truth.
 *
 * Tesseract averages 64.5/100 on real receipt photographs (measured over 183
 * images), and its failures are not graceful — a lost decimal point produces
 * a number that is wrong by a factor of ten but looks entirely plausible.
 * A vision model reads the paper the way a person does, so it degrades on
 * genuinely illegible input rather than on merely unusual fonts.
 *
 * The OCR text is still passed along as a hint where available: it costs
 * little and helps settle small print, provided the prompt is clear that the
 * image wins any disagreement.
 */
export async function extractReceiptFromImage(input: {
  image: Buffer;
  ocrText?: string;
  ocrConfidence?: number;
  defaultCurrency?: string;
  signal?: AbortSignal;
}): Promise<ExtractResult & { imageBytes: number }> {
  const model = env.OPENROUTER_VISION_MODEL;
  const { dataUrl, bytes } = await prepareForVision(input.image);
  const started = Date.now();

  const completion = await llm().chat.completions.create(
    {
      model,
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACT_VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVisionUserPrompt({
                ocrText: input.ocrText,
                ocrConfidence: input.ocrConfidence,
                defaultCurrency: input.defaultCurrency ?? "GBP",
                today: new Date().toISOString().slice(0, 10),
              }),
            },
            {
              type: "image_url",
              // "high" detail: receipt line items are small print, and the
              // low-detail path downsamples to a size where prices blur into
              // one another — exactly the figures that matter most.
              image_url: { url: dataUrl, detail: "high" },
            },
          ],
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
      `Vision model ${model} returned an empty response. Confirm it supports both image input and strict json_schema.`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new LLMResponseError(
      `Vision model ${model} returned content that is not valid JSON.`,
      raw,
    );
  }

  const parsed = ExtractedReceiptSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new LLMResponseError(
      `Vision model ${model} returned JSON that does not match the schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      raw,
    );
  }

  return {
    receipt: parsed.data,
    usage: readUsage(model, latencyMs, completion.usage),
    promptVersion: EXTRACT_VISION_PROMPT_VERSION,
    raw,
    imageBytes: bytes,
  };
}
