import type { ExtractedReceipt } from "@/receipts/orchestrator/schemas";
import type { ReconcileWarning } from "@/receipts/orchestrator/reconcile";

/**
 * The wire contract for /api/receipts/analyze.
 *
 * Declared separately from AnalyzeResult because the route reshapes the
 * payload — word bounding boxes are dropped until the review screen needs
 * them. Keeping the client's expectations explicit means a change to the
 * server-side result type cannot silently break the browser.
 *
 * Type-only imports, so nothing server-side is pulled into the client bundle.
 */

export type StageName =
  | "preprocess"
  | "ocr"
  | "extract"
  | "reconcile"
  | "done"
  | "failed";

export type StageMessage = {
  type: "stage";
  stage: StageName;
  label: string;
  elapsedMs: number;
};

export type ResultMessage = {
  type: "result";
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  filename?: string;
  /** Present once the analysis has been written to the database. */
  receiptId?: string;

  ocr: {
    text: string;
    confidence: number;
    engine: string;
    width: number;
    height: number;
    durationMs: number;
    wordCount: number;
  };

  receipt?: ExtractedReceipt;
  warnings: ReconcileWarning[];
  needsReview: boolean;
  meanConfidence?: number;

  /** "text" = read from OCR output; "vision" = image sent to the model. */
  path?: "text" | "vision";
  pathReason?: string;

  timings: Record<string, number>;
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
  promptVersion?: string;
};

export type AnalyzeMessage = StageMessage | ResultMessage;

/** The stages a user sees, in order, for the progress list. */
export const PIPELINE_STAGES: ReadonlyArray<{
  stage: StageName;
  label: string;
}> = [
  { stage: "preprocess", label: "Preparing the image" },
  { stage: "ocr", label: "Reading the text" },
  { stage: "extract", label: "Understanding the receipt" },
  { stage: "reconcile", label: "Checking the numbers" },
];

/**
 * Parses an NDJSON byte stream into messages.
 *
 * Chunk boundaries fall wherever the network puts them, so a partial line must
 * be carried over rather than parsed — the naive `split("\n")` per chunk drops
 * or corrupts a message roughly whenever the response is large enough to matter.
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnalyzeMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // last element is an incomplete line

      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as AnalyzeMessage;
      }
    }

    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as AnalyzeMessage;
  } finally {
    reader.releaseLock();
  }
}
