import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { analyzeReceipt, type AnalyzeResult, type StageEvent } from "@/lib/pipeline/analyze";
import { requireScope, UnauthorizedError } from "@/lib/db/scope";
import {
  checksumOf,
  findExistingByChecksum,
  persistAnalysis,
} from "@/lib/receipts/persist";

/**
 * POST /api/receipts/analyze
 *
 * Multipart upload in, newline-delimited JSON out:
 *   {"type":"stage","stage":"ocr","label":"Reading the text…","elapsedMs":812}
 *   {"type":"result", ...}
 *
 * Streaming rather than a single JSON response because the pipeline takes
 * several seconds and named stages ("Reading the text…") read as far faster
 * than an indeterminate spinner. NDJSON over POST rather than SSE, since
 * EventSource cannot issue a POST and the payload is a file upload.
 *
 * No persistence yet — this is the pipeline slice. Storage, the queue and
 * auth wrap this route; they are deliberately not wired into it.
 */

// sharp and tesseract.js are native/WASM; neither can run on the Edge runtime.
export const runtime = "nodejs";
export const maxDuration = 120;

const ACCEPTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);

export async function POST(req: NextRequest) {
  // Middleware only checks that a cookie exists — this is the real gate, and
  // it supplies the workspace every write below is scoped to.
  let scope;
  try {
    scope = await requireScope();
  } catch (e) {
    if (e instanceof UnauthorizedError) return problem(401, e.message);
    throw e;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return problem(400, "Expected a multipart/form-data upload.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return problem(400, "No file was provided under the field name 'file'.");
  }

  if (file.size === 0) {
    return problem(400, "The uploaded file is empty.");
  }

  if (file.size > env.MAX_UPLOAD_BYTES) {
    return problem(
      413,
      `That image is ${(file.size / 1_048_576).toFixed(1)} MB. The limit is ${(env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(0)} MB.`,
    );
  }

  // Trust the sniffed type over the declared one where they disagree; browsers
  // send an empty type for some camera captures.
  if (file.type && !ACCEPTED.has(file.type)) {
    return problem(
      415,
      `${file.type} is not a supported image format. Use JPEG, PNG, WebP or HEIC.`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = checksumOf(buffer);

  // Re-uploading the same image must never trigger a second paid pipeline run.
  const duplicate = await findExistingByChecksum(scope, checksum);
  if (duplicate) {
    return Response.json(
      {
        duplicate: true,
        receiptId: duplicate.id,
        detail: "This receipt has already been added.",
      },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

      try {
        const result: AnalyzeResult = await analyzeReceipt(buffer, {
          signal: req.signal,
          onStage: (e: StageEvent) => send({ type: "stage", ...e }),
        });

        // Persist before responding, so a client that navigates away the
        // instant the result lands does not lose a receipt it already paid
        // to process.
        let receiptId: string | undefined;
        try {
          const saved = await persistAnalysis({
            scope,
            result,
            checksum,
            file: { name: file.name, mimeType: file.type, size: file.size },
          });
          receiptId = saved.receipt.id;
        } catch (e) {
          // A storage failure must not discard a successful extraction — show
          // the user their result and record the problem.
          console.error("[receipts] failed to persist analysis", e);
        }

        send({
          type: "result",
          ...result,
          receiptId,
          // Bounding boxes are large and the current UI does not consume them.
          // They come back when the review screen lands (spec §8.5).
          ocr: { ...result.ocr, words: undefined, wordCount: result.ocr.words.length },
          filename: file.name,
        });
      } catch (e) {
        send({
          type: "result",
          ok: false,
          errorCode: "UNKNOWN",
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Without this a reverse proxy will buffer the whole response and the
      // stage updates all arrive at once, defeating the point.
      "X-Accel-Buffering": "no",
    },
  });
}

function problem(status: number, detail: string) {
  return Response.json(
    { type: "about:blank", title: "Bad Request", status, detail },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}
