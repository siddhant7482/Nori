import { z } from "zod";

/* ============================================================
   What the receipt engine needs, and nothing else.

   The hackathon version of this file validated the whole app's
   environment: auth secrets, object storage, mail. Nori keeps its
   own settings elsewhere, so this is trimmed to the reading of a
   photograph: where the model lives, and when to stop trusting the
   text Tesseract produced.

   Without a key the engine still reads receipts on the node; it just
   stops before the model and hands back whatever OCR managed.
   ============================================================ */

if (typeof window !== "undefined") {
  throw new Error("src/receipts/env.ts holds secrets — import it only from server code.");
}

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  /** Must support strict json_schema responses: the extraction contract
   *  depends on it. */
  OPENROUTER_EXTRACT_MODEL: z.string().default("openai/gpt-4.1-mini"),
  /** Must additionally accept an image. Used when the OCR text is too
   *  poor to trust. */
  OPENROUTER_VISION_MODEL: z.string().default("openai/gpt-4.1-mini"),
  OPENROUTER_SITE_URL: z.url().optional(),
  OPENROUTER_APP_NAME: z.string().default("Nori"),

  /** Below this, the recognised text is not worth sending anywhere. */
  OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(100).default(40),
  /**
   * Below this mean confidence the image goes to the vision model
   * instead of its text.
   *
   * Measured on 183 real receipt photographs: mean 64.5, max 90.8. At
   * the default of 90 effectively every real photograph takes the
   * vision path and OCR is a fast path that rarely fires. Lower it to
   * trade accuracy for keeping more receipts on the node.
   */
  OCR_VISION_THRESHOLD: z.coerce.number().min(0).max(100).default(90),
  OCR_WORKER_POOL_SIZE: z.coerce.number().int().min(1).max(4).default(1),
  /** Set false and no image ever leaves the node. */
  VISION_FALLBACK_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
});

/* An unset key is usually written FOO="" rather than omitted. Zod sees
 * a present empty string and fails .optional(), so blanks are stripped
 * first and the defaults apply as intended. */
const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
const parsed = schema.safeParse(present);

if (!parsed.success) {
  throw new Error("Receipt engine configuration is wrong:\n" + parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n"));
}

export const env = parsed.data;
export type Env = typeof env;

/** When false, reading stops after OCR and the figures are yours to
 *  confirm by hand. */
export const hasLLM = Boolean(env.OPENROUTER_API_KEY);
