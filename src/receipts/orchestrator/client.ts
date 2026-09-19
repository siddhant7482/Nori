import OpenAI from "openai";
import { env, hasLLM } from "@/receipts/env";

/**
 * OpenRouter speaks the OpenAI wire protocol, so the official SDK works
 * unchanged with a different baseURL. That keeps the option of pointing at
 * OpenAI, a local vLLM, or any other compatible gateway by changing one env
 * var — no client code moves.
 */

let client: OpenAI | null = null;

export function llm(): OpenAI {
  if (!hasLLM) {
    throw new LLMDisabledError();
  }
  if (!client) {
    client = new OpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL,
      timeout: 60_000,
      maxRetries: 2, // SDK retries 429s and 5xx with backoff
      defaultHeaders: {
        ...(env.OPENROUTER_SITE_URL
          ? { "HTTP-Referer": env.OPENROUTER_SITE_URL }
          : {}),
        "X-Title": env.OPENROUTER_APP_NAME,
      },
    });
  }
  return client;
}

export class LLMDisabledError extends Error {
  readonly code = "LLM_DISABLED";
  constructor() {
    super(
      "OPENROUTER_API_KEY is not set — extraction is disabled and the receipt stops after OCR.",
    );
    this.name = "LLMDisabledError";
  }
}

export class LLMResponseError extends Error {
  readonly code = "LLM_BAD_RESPONSE";
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message);
    this.name = "LLMResponseError";
  }
}

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** OpenRouter reports spend in USD when the generation endpoint is queried. */
  costUsd?: number;
};

/** Normalises the SDK's optional usage block into something always present. */
export function readUsage(
  model: string,
  latencyMs: number,
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null,
): Usage {
  return {
    model,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    latencyMs,
  };
}
