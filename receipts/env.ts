import { z } from "zod";

// Not `server-only`: that package throws under any condition other than
// `react-server`, which would make this module unimportable from the
// standalone OCR worker. An explicit browser check gives the same protection
// against leaking secrets into a client bundle, in both runtimes.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/env.ts was imported into a client bundle. It holds secrets — " +
      "import it only from server components, route handlers, or the worker.",
  );
}


/**
 * Boot-time environment validation.
 *
 * This module is imported for its side effect: if anything is missing or
 * malformed the process dies here, at startup, with a list of every problem
 * at once. The alternative is discovering a missing S3 key when the first
 * user upload fails at 2am, which is how you lose a receipt.
 *
 * Never import this from a client component — `server-only` will turn that
 * into a build error rather than leaking secrets into the browser bundle.
 */

const port = z.coerce.number().int().positive();
const bytes = z.coerce.number().int().positive();

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z
    .string()
    .startsWith("postgres", "must be a postgres:// or postgresql:// URL"),

  // ---- Auth.js ----
  AUTH_SECRET: z
    .string()
    .min(32, "generate one with: openssl rand -base64 32"),
  AUTH_URL: z.url().optional(),
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  EMAIL_SERVER: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

  // ---- MinIO / S3 ----
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // MinIO serves buckets as a path segment, not a subdomain. Getting this
  // wrong produces DNS errors that look nothing like a config problem.
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  S3_PUBLIC_ENDPOINT: z.url().optional(),

  // ---- OpenRouter (OpenAI-compatible API) ----
  // Optional by design: §7.7 requires the app to remain functional with the
  // LLM step disabled, which also lets a contributor run everything up to and
  // including OCR without holding a billable key.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  // Must be a model that supports strict json_schema response_format —
  // the extraction contract in §7.2 depends on it.
  // Project constraint: OpenAI models only. See assertOpenAIModels below.
  OPENROUTER_EXTRACT_MODEL: z.string().default("openai/gpt-4.1-mini"),
  // Must additionally support image input. Used when OCR confidence falls
  // below OCR_VISION_THRESHOLD and the image is sent directly.
  OPENROUTER_VISION_MODEL: z.string().default("openai/gpt-4.1-mini"),
  OPENROUTER_SUMMARY_MODEL: z.string().default("openai/gpt-4.1-mini"),
  // Sent as HTTP-Referer / X-Title. OpenRouter uses these for attribution on
  // its public leaderboards; both are optional and purely cosmetic.
  OPENROUTER_SITE_URL: z.url().optional(),
  OPENROUTER_APP_NAME: z.string().default("Nori"),

  // ---- Limits ----
  MAX_UPLOAD_BYTES: bytes.default(10_485_760),
  DAILY_RECEIPT_LIMIT: z.coerce.number().int().positive().default(200),
  OCR_WORKER_POOL_SIZE: z.coerce.number().int().min(1).max(16).default(2),
  OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(100).default(40),
  /**
   * Below this mean OCR confidence the image is sent to a vision model
   * instead of trusting the recognised text.
   *
   * Measured on 183 real receipt photographs: mean 64.5, max 90.8. At the
   * default of 90 effectively every real receipt takes the vision path and
   * OCR becomes a fast-path that rarely fires. Lower it to trade accuracy
   * for cost once you have numbers you trust.
   */
  OCR_VISION_THRESHOLD: z.coerce.number().min(0).max(100).default(90),
  /** Set false to force the text path and never send images to the model. */
  VISION_FALLBACK_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  WORKER_PORT: port.default(3001),
});

// An unset key in a .env file is usually written `FOO=""`, not omitted. Zod
// sees that as a present-but-empty string and fails `.optional()`, so strip
// blanks first and let defaults and optionals apply as intended.
const present = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
);

const parsed = schema.safeParse(present);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");

  throw new Error(
    `\n\n  Invalid environment configuration\n` +
      `  ─────────────────────────────────\n${issues}\n\n` +
      `  Copy .env.example to .env and fill in the blanks.\n`,
  );
}

export const env = parsed.data;
export type Env = typeof env;

/**
 * Auth.js providers are configured conditionally on what is present, so a
 * developer can run the app with only magic-link mail, or only Google,
 * without stubbing credentials they don't have.
 */
export const hasGoogleAuth = Boolean(
  env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET,
);
export const hasEmailAuth = Boolean(env.EMAIL_SERVER && env.EMAIL_FROM);

/** When false the pipeline stops after OCR and files the receipt for manual entry. */
export const hasLLM = Boolean(env.OPENROUTER_API_KEY);

/**
 * Project constraint: OpenAI models only.
 *
 * OpenRouter will happily route to any provider, and a model swapped in
 * casually may not support strict `json_schema` or image input — both of
 * which this pipeline depends on. Warn loudly rather than fail, so an
 * intentional experiment is still possible.
 */
for (const [name, model] of [
  ["OPENROUTER_EXTRACT_MODEL", env.OPENROUTER_EXTRACT_MODEL],
  ["OPENROUTER_VISION_MODEL", env.OPENROUTER_VISION_MODEL],
  ["OPENROUTER_SUMMARY_MODEL", env.OPENROUTER_SUMMARY_MODEL],
] as const) {
  if (!model.startsWith("openai/")) {
    console.warn(
      `[env] ${name}="${model}" is not an OpenAI model. This project targets openai/* only — ` +
        `strict json_schema and image input are not guaranteed elsewhere.`,
    );
  }
}

if (!hasGoogleAuth && !hasEmailAuth) {
  // Not fatal at build time, but the sign-in page would have no buttons.
  console.warn(
    "[env] No auth provider configured — set AUTH_GOOGLE_* or EMAIL_SERVER + EMAIL_FROM.",
  );
}
if (!hasLLM) {
  console.warn(
    "[env] OPENROUTER_API_KEY not set — receipts will stop after OCR and skip extraction.",
  );
}
