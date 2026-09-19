import { env, hasLLM } from "@/receipts/env";
import { preprocessReceipt } from "@/receipts/ocr/preprocess";
import { recognize, type OcrWord } from "@/receipts/ocr/tesseract";
import { extractReceipt } from "@/receipts/orchestrator/extract";
import { extractReceiptFromImage } from "@/receipts/orchestrator/extract-vision";
import { reconcile, type ReconcileWarning } from "@/receipts/orchestrator/reconcile";
import { LLMDisabledError, LLMResponseError } from "@/receipts/orchestrator/client";
import type { ExtractedReceipt } from "@/receipts/orchestrator/schemas";

/**
 * The receipt pipeline, end to end: bytes in, structured analysis out.
 *
 * Deliberately free of database, storage and session concerns so it can be
 * driven identically from the API route, the queue worker, and the CLI
 * fixture harness. Persistence wraps this; it is never wired into it.
 */

export type Stage =
  | "preprocess"
  | "ocr"
  | "extract"
  | "reconcile"
  | "done"
  | "failed";

/**
 * Which route produced the extraction.
 *
 * `text`   — OCR was confident enough to be trusted as the source.
 * `vision` — the image itself went to the model; OCR text rode along as a hint.
 */
export type ExtractionPath = "text" | "vision";

export type StageEvent = {
  stage: Stage;
  /** Human-readable, shown directly in the UI — no vague progress bars. */
  label: string;
  elapsedMs: number;
};

export type AnalyzeErrorCode =
  | "UNREADABLE_IMAGE"
  | "LOW_OCR_QUALITY"
  | "LLM_DISABLED"
  | "LLM_BAD_RESPONSE"
  | "LLM_UNAVAILABLE"
  | "UNKNOWN";

export type AnalyzeResult = {
  ok: boolean;
  errorCode?: AnalyzeErrorCode;
  errorMessage?: string;

  ocr: {
    text: string;
    confidence: number;
    words: OcrWord[];
    engine: string;
    width: number;
    height: number;
    durationMs: number;
  };

  receipt?: ExtractedReceipt;
  warnings: ReconcileWarning[];
  needsReview: boolean;
  meanConfidence?: number;

  /** Which route ran, and why. Surfaced so a bad result can be attributed. */
  path?: ExtractionPath;
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

const STAGE_LABELS: Record<Stage, string> = {
  preprocess: "Preparing the image…",
  ocr: "Reading the text…",
  extract: "Understanding the receipt…",
  reconcile: "Checking the numbers…",
  done: "Done",
  failed: "Failed",
};

export async function analyzeReceipt(
  input: Buffer,
  opts: {
    defaultCurrency?: string;
    onStage?: (e: StageEvent) => void;
    signal?: AbortSignal;
    /** Override the confidence routing. Used by the A/B benchmark. */
    forcePath?: ExtractionPath;
  } = {},
): Promise<AnalyzeResult> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const emit = (stage: Stage) =>
    opts.onStage?.({
      stage,
      label: STAGE_LABELS[stage],
      elapsedMs: Date.now() - t0,
    });

  // ---- 1. Preprocess -------------------------------------------------------
  emit("preprocess");
  const tPre = Date.now();
  let prepared;
  try {
    prepared = await preprocessReceipt(input);
  } catch (e) {
    emit("failed");
    return failure("UNREADABLE_IMAGE", messageOf(e), timings);
  }
  timings.preprocess = Date.now() - tPre;

  // ---- 2. OCR --------------------------------------------------------------
  emit("ocr");
  const tOcr = Date.now();
  const ocr = await recognize(prepared.image);
  timings.ocr = Date.now() - tOcr;

  const ocrBlock = {
    text: ocr.text,
    confidence: ocr.confidence,
    words: ocr.words,
    engine: ocr.engine,
    width: prepared.width,
    height: prepared.height,
    durationMs: ocr.durationMs,
  };

  // ---- 3. Quality gate -----------------------------------------------------
  //
  // Sending near-garbage TEXT to the model is worse than failing: it produces
  // confident, well-formed, entirely fabricated numbers.
  //
  // But this gate must not fire when the vision path is available — illegible
  // OCR is precisely the case vision exists to rescue, and failing here would
  // reject images a vision model reads without difficulty. The gate therefore
  // only guards the text route.
  const ocrUnusable =
    ocr.confidence < env.OCR_MIN_CONFIDENCE || ocr.text.trim().length < 20;

  if (ocrUnusable && (!env.VISION_FALLBACK_ENABLED || opts.forcePath === "text")) {
    emit("failed");
    return {
      ok: false,
      errorCode: "LOW_OCR_QUALITY",
      errorMessage:
        `The text on this image could not be read reliably ` +
        `(confidence ${ocr.confidence.toFixed(0)}/100, minimum ${env.OCR_MIN_CONFIDENCE}). ` +
        `Try again with more light, the receipt flat, and the camera square-on.`,
      ocr: ocrBlock,
      warnings: [],
      needsReview: true,
      timings,
    };
  }

  if (!hasLLM) {
    emit("failed");
    return {
      ok: false,
      errorCode: "LLM_DISABLED",
      errorMessage: new LLMDisabledError().message,
      ocr: ocrBlock,
      warnings: [],
      needsReview: true,
      timings,
    };
  }

  // ---- 4. Extract ----------------------------------------------------------
  //
  // Route on OCR confidence. Tesseract's failures are not graceful: a lost
  // decimal point yields a figure wrong by a factor of ten that still looks
  // entirely plausible. Below the threshold the image goes to a vision model
  // and the OCR text rides along only as a hint.
  const forcePath = opts.forcePath;
  const useVision =
    forcePath === "vision" ||
    (forcePath !== "text" &&
      env.VISION_FALLBACK_ENABLED &&
      // Unusable OCR must go to vision regardless of where the threshold sits.
      (ocrUnusable || ocr.confidence < env.OCR_VISION_THRESHOLD));

  const path: ExtractionPath = useVision ? "vision" : "text";
  const pathReason = forcePath
    ? `forced to ${forcePath}`
    : useVision
      ? `OCR confidence ${ocr.confidence.toFixed(1)} is below the vision threshold of ${env.OCR_VISION_THRESHOLD}`
      : `OCR confidence ${ocr.confidence.toFixed(1)} met the threshold of ${env.OCR_VISION_THRESHOLD}`;

  emit("extract");
  const tEx = Date.now();
  let extraction;
  try {
    extraction = useVision
      ? await extractReceiptFromImage({
          // The ORIGINAL bytes, not the OCR-preprocessed bitmap. The
          // thresholded greyscale that helps Tesseract actively destroys
          // information a vision model uses.
          image: input,
          ocrText: ocr.text,
          ocrConfidence: ocr.confidence,
          defaultCurrency: opts.defaultCurrency,
          signal: opts.signal,
        })
      : await extractReceipt({
          ocrText: ocr.text,
          ocrConfidence: ocr.confidence,
          defaultCurrency: opts.defaultCurrency,
          signal: opts.signal,
        });
  } catch (e) {
    timings.extract = Date.now() - tEx;
    emit("failed");
    const code: AnalyzeErrorCode =
      e instanceof LLMResponseError
        ? "LLM_BAD_RESPONSE"
        : e instanceof LLMDisabledError
          ? "LLM_DISABLED"
          : "LLM_UNAVAILABLE";
    return {
      ...failure(code, messageOf(e), timings),
      ocr: ocrBlock,
      path,
      pathReason,
    };
  }
  timings.extract = Date.now() - tEx;

  // ---- 5. Reconcile --------------------------------------------------------
  emit("reconcile");
  const tRec = Date.now();
  const checked = reconcile(extraction.receipt);
  timings.reconcile = Date.now() - tRec;
  timings.total = Date.now() - t0;

  emit("done");

  return {
    ok: true,
    ocr: ocrBlock,
    receipt: extraction.receipt,
    warnings: checked.warnings,
    needsReview: checked.needsReview,
    meanConfidence: checked.meanConfidence,
    path,
    pathReason,
    timings,
    usage: extraction.usage,
    promptVersion: extraction.promptVersion,
  };
}

function failure(
  errorCode: AnalyzeErrorCode,
  errorMessage: string,
  timings: Record<string, number>,
): AnalyzeResult {
  return {
    ok: false,
    errorCode,
    errorMessage,
    ocr: {
      text: "",
      confidence: 0,
      words: [],
      engine: "",
      width: 0,
      height: 0,
      durationMs: 0,
    },
    warnings: [],
    needsReview: true,
    timings,
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
