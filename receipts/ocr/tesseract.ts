import path from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { env } from "@/lib/env";

/**
 * Pooled Tesseract recognition.
 *
 * Spinning up a worker costs a couple of seconds — far more than recognising
 * a receipt — so workers are created once and held for the process lifetime.
 * The pool also bounds concurrency: each worker holds its own WASM heap, and
 * unbounded parallelism is the fastest way to OOM the container.
 */

export type OcrWord = {
  text: string;
  /** 0-100, Tesseract's own per-word confidence. */
  confidence: number;
  /** [x0, y0, x1, y1] in pixels of the preprocessed image. */
  bbox: [number, number, number, number];
};

export type OcrResult = {
  text: string;
  /** Mean word confidence, 0-100. */
  confidence: number;
  words: OcrWord[];
  engine: string;
  durationMs: number;
};

// Language data is fetched once and cached on disk. Without an explicit path
// tesseract.js drops traineddata into the process CWD, which differs between
// `next dev`, the worker, and the CLI — and re-downloads for each.
const CACHE_PATH = path.join(process.cwd(), ".cache", "tesseract");

const LANG = "eng";
const ENGINE = "tesseract.js/eng";

type PooledWorker = { worker: Worker; busy: boolean };

let pool: PooledWorker[] | null = null;
let initializing: Promise<PooledWorker[]> | null = null;
const waiters: Array<(w: PooledWorker) => void> = [];

async function makeWorker(): Promise<PooledWorker> {
  const worker = await createWorker(LANG, undefined, {
    cachePath: CACHE_PATH,
    // tesseract.js is chatty on stdout; keep the app's logs readable.
    logger: () => {},
    errorHandler: (e) => console.error("[ocr] worker error", e),
  });

  await worker.setParameters({
    // A receipt is a single tall column of text. AUTO tries to find multiple
    // columns and routinely interleaves the price column into the item names.
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: "1",
  });

  return { worker, busy: false };
}

async function getPool(): Promise<PooledWorker[]> {
  if (pool) return pool;
  if (initializing) return initializing;

  initializing = (async () => {
    const size = env.OCR_WORKER_POOL_SIZE;
    pool = await Promise.all(Array.from({ length: size }, makeWorker));
    return pool;
  })();

  return initializing;
}

async function acquire(): Promise<PooledWorker> {
  const p = await getPool();
  const free = p.find((w) => !w.busy);
  if (free) {
    free.busy = true;
    return free;
  }
  // All busy — queue until one is released, rather than creating an
  // unbounded number of WASM heaps under load.
  return new Promise((resolve) => waiters.push(resolve));
}

function release(w: PooledWorker) {
  const next = waiters.shift();
  if (next) {
    next(w); // hand the worker straight over, still marked busy
    return;
  }
  w.busy = false;
}

/** Flattens tesseract.js v6+ block output down to a flat word list. */
type Rect = { x0: number; y0: number; x1: number; y1: number };
type RawWord = { text?: string; confidence?: number; bbox?: Rect };
type RawLine = { words?: RawWord[] };
type RawParagraph = { lines?: RawLine[] };
type RawBlock = { paragraphs?: RawParagraph[] };

function collectWords(data: { words?: RawWord[]; blocks?: RawBlock[] | null }) {
  // v5 exposed `data.words` directly; v6+ nests them under blocks and only
  // populates them when `blocks: true` is requested. Handle both so a minor
  // tesseract.js bump does not silently empty the bounding boxes that the
  // review screen depends on.
  const raw: RawWord[] =
    data.words && data.words.length > 0
      ? data.words
      : (data.blocks ?? []).flatMap((b) =>
          (b.paragraphs ?? []).flatMap((p) =>
            (p.lines ?? []).flatMap((l) => l.words ?? []),
          ),
        );

  return raw
    .filter((w): w is Required<RawWord> => Boolean(w?.text?.trim() && w.bbox))
    .map<OcrWord>((w) => ({
      text: w.text.trim(),
      confidence: w.confidence ?? 0,
      bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1],
    }));
}

export async function recognize(image: Buffer): Promise<OcrResult> {
  const started = Date.now();
  const pooled = await acquire();

  try {
    const { data } = await pooled.worker.recognize(
      image,
      {},
      // Bounding boxes are not optional for us — they drive the field-to-image
      // highlighting in the review screen (spec §8.5).
      { text: true, blocks: true },
    );

    const words = collectWords(data);

    // Tesseract's document-level confidence is dominated by whitespace and
    // punctuation. A mean over real words tracks legibility far better and is
    // what the quality gate in §6.3 keys off.
    const confidence =
      words.length > 0
        ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
        : 0;

    return {
      text: data.text ?? "",
      confidence,
      words,
      engine: ENGINE,
      durationMs: Date.now() - started,
    };
  } finally {
    release(pooled);
  }
}

/** Call on graceful shutdown so WASM heaps are not leaked between reloads. */
export async function terminateOcrPool(): Promise<void> {
  if (!pool) return;
  await Promise.all(pool.map((p) => p.worker.terminate()));
  pool = null;
  initializing = null;
}
