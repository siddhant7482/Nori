import "./_env.mjs"; // must stay first — see scripts/_env.mts
/**
 * Benchmarks the pipeline against a directory of real receipt photographs.
 *
 *   npx tsx scripts/bench-real.mts                     # OCR only, all images
 *   npx tsx scripts/bench-real.mts --llm 40            # + extraction on 40
 *   npx tsx scripts/bench-real.mts --llm all --out r.jsonl
 *
 * There is no ground truth for this set, so field accuracy cannot be scored.
 * What CAN be measured honestly:
 *
 *   - OCR confidence distribution and how many images fall below the gate
 *   - how often extraction returns a total, merchant and date at all
 *   - the RECONCILIATION RATE — how often subtotal + tax + tip equals the
 *     total the model reported
 *
 * That last one is the useful proxy. It is an internal-consistency check the
 * model cannot game by guessing: a hallucinated total will not agree with
 * hallucinated components. It is a lower bound on correctness, not a
 * substitute for labelled data.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeReceipt } from "../lib/pipeline/analyze";
import { terminateOcrPool } from "../lib/ocr/tesseract";
import { preprocessReceipt } from "../lib/ocr/preprocess";
import { recognize } from "../lib/ocr/tesseract";
import { env } from "../lib/env";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DIR = path.resolve(arg("--dir") ?? "receipts_train");
const llmArg = arg("--llm");
const outFile = arg("--out");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

/** Skip anything that is not actually an image, whatever its extension says. */
async function isImage(file: string): Promise<boolean> {
  const fd = await readFile(file);
  if (fd.length < 4) return false;
  const jpeg = fd[0] === 0xff && fd[1] === 0xd8 && fd[2] === 0xff;
  const png = fd[0] === 0x89 && fd[1] === 0x50 && fd[2] === 0x4e;
  const webp = fd.subarray(8, 12).toString("ascii") === "WEBP";
  return jpeg || png || webp;
}

const all = (await readdir(DIR)).sort();
const files: string[] = [];
for (const f of all) {
  const full = path.join(DIR, f);
  try {
    if (await isImage(full)) files.push(full);
  } catch {
    /* directories, unreadable entries */
  }
}

console.log();
console.log(bold(`  ${files.length} images in ${path.basename(DIR)}`));
console.log(dim(`  (${all.length - files.length} non-image entries skipped)`));
console.log();

type Row = {
  file: string;
  ocrConfidence: number;
  words: number;
  belowGate: boolean;
  ocrMs: number;

  extracted?: boolean;
  errorCode?: string;
  merchant?: string | null;
  currency?: string | null;
  date?: string | null;
  total?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  lineItems?: number;
  category?: string | null;
  reconciles?: boolean | null;
  warnings?: string[];
  inputTokens?: number;
  outputTokens?: number;
  totalMs?: number;
};

const rows: Row[] = [];

// ---- Pass 1: OCR every image (free, and the central risk in spec §13) ------
process.stdout.write("  OCR: ");
for (const [i, file] of files.entries()) {
  const buf = await readFile(file);
  try {
    const pre = await preprocessReceipt(buf);
    const ocr = await recognize(pre.image);
    rows.push({
      file: path.basename(file),
      ocrConfidence: ocr.confidence,
      words: ocr.words.length,
      belowGate:
        ocr.confidence < env.OCR_MIN_CONFIDENCE || ocr.text.trim().length < 20,
      ocrMs: ocr.durationMs,
    });
  } catch {
    rows.push({
      file: path.basename(file),
      ocrConfidence: 0,
      words: 0,
      belowGate: true,
      ocrMs: 0,
    });
  }
  if ((i + 1) % 10 === 0) process.stdout.write(".");
}
console.log(` ${files.length} done`);
console.log();

// ---- OCR report ------------------------------------------------------------
const confs = rows.map((r) => r.ocrConfidence).sort((a, b) => a - b);
const pct = (p: number) => confs[Math.floor((confs.length - 1) * p)];
const mean = confs.reduce((a, b) => a + b, 0) / confs.length;
const belowGate = rows.filter((r) => r.belowGate);

console.log(bold("  OCR confidence"));
console.log(
  `    mean ${mean.toFixed(1)}   p10 ${pct(0.1).toFixed(1)}   median ${pct(0.5).toFixed(1)}   p90 ${pct(0.9).toFixed(1)}   min ${confs[0].toFixed(1)}   max ${confs.at(-1)!.toFixed(1)}`,
);

// Histogram — the shape matters more than the mean. A bimodal spread means
// "works or fails outright", which needs a different fix than a low average.
const buckets = [0, 40, 55, 70, 80, 85, 90, 95, 101];
console.log();
for (let i = 0; i < buckets.length - 1; i++) {
  const lo = buckets[i];
  const hi = buckets[i + 1];
  const n = confs.filter((c) => c >= lo && c < hi).length;
  const bar = "█".repeat(Math.round((n / confs.length) * 46));
  const label = `${lo}–${hi === 101 ? 100 : hi}`.padStart(7);
  const color = lo < env.OCR_MIN_CONFIDENCE ? red : lo < 70 ? amber : green;
  console.log(`    ${label}  ${color(bar)} ${n}`);
}

console.log();
console.log(
  `    below the gate of ${env.OCR_MIN_CONFIDENCE}: ${belowGate.length}/${rows.length} (${((belowGate.length / rows.length) * 100).toFixed(1)}%)`,
);
console.log(
  dim(
    `    mean OCR time ${Math.round(rows.reduce((a, r) => a + r.ocrMs, 0) / rows.length)}ms`,
  ),
);
console.log();

// ---- Pass 2: extraction on a sample ---------------------------------------
if (llmArg) {
  const usable = rows.filter((r) => !r.belowGate);
  const n = llmArg === "all" ? usable.length : Math.min(Number(llmArg), usable.length);

  // Even stride across the confidence-sorted set, so the sample is not just
  // the easiest images.
  const sorted = [...usable].sort((a, b) => a.ocrConfidence - b.ocrConfidence);
  const stride = Math.max(1, Math.floor(sorted.length / n));
  const sample = Array.from({ length: n }, (_, i) => sorted[i * stride]).filter(Boolean);

  console.log(bold(`  Extraction on ${sample.length} images`));
  process.stdout.write("  ");

  for (const [i, row] of sample.entries()) {
    const buf = await readFile(path.join(DIR, row.file));
    const t0 = Date.now();
    const res = await analyzeReceipt(buf);
    row.totalMs = Date.now() - t0;

    if (!res.ok || !res.receipt) {
      row.extracted = false;
      row.errorCode = res.errorCode;
      process.stdout.write(red("x"));
    } else {
      const r = res.receipt;
      row.extracted = true;
      row.merchant = r.merchantName;
      row.currency = r.currency;
      row.date = r.purchasedAt;
      row.total = r.total;
      row.subtotal = r.subtotal;
      row.tax = r.taxTotal;
      row.tip = r.tipTotal;
      row.lineItems = r.lineItems.length;
      row.category = r.category;
      row.warnings = res.warnings.map((w) => w.field);
      row.inputTokens = res.usage?.inputTokens;
      row.outputTokens = res.usage?.outputTokens;

      // Internal consistency: does the arithmetic the model reported agree?
      // Accepts both the additive (US sales tax) and inclusive (UK/EU VAT)
      // conventions — see lib/orchestrator/reconcile.ts. Scoring only the
      // additive form would understate accuracy on any VAT-inclusive receipt.
      row.reconciles =
        r.total !== null && r.subtotal !== null
          ? Math.abs(r.subtotal + (r.taxTotal ?? 0) + (r.tipTotal ?? 0) - r.total) <= 2 ||
            Math.abs(r.subtotal + (r.tipTotal ?? 0) - r.total) <= 2
          : null;

      process.stdout.write(row.reconciles === false ? amber("!") : green("."));
    }
    if ((i + 1) % 50 === 0) process.stdout.write("\n  ");
  }

  console.log("\n");

  const done = sample.filter((r) => r.extracted);
  const share = (k: number) => `${((k / sample.length) * 100).toFixed(0)}%`;
  const withTotal = done.filter((r) => r.total !== null);
  const withMerchant = done.filter((r) => r.merchant);
  const withDate = done.filter((r) => r.date);
  const withCategory = done.filter((r) => r.category);
  const checkable = done.filter((r) => r.reconciles !== null);
  const reconciled = checkable.filter((r) => r.reconciles);

  console.log(bold("  Extraction results"));
  console.log(`    completed              ${done.length}/${sample.length}  ${share(done.length)}`);
  console.log(`    total found            ${withTotal.length}/${sample.length}  ${share(withTotal.length)}`);
  console.log(`    merchant found         ${withMerchant.length}/${sample.length}  ${share(withMerchant.length)}`);
  console.log(`    date found             ${withDate.length}/${sample.length}  ${share(withDate.length)}`);
  console.log(`    category assigned      ${withCategory.length}/${sample.length}  ${share(withCategory.length)}`);
  console.log();
  console.log(
    `    ${bold("arithmetic reconciles")}  ${reconciled.length}/${checkable.length}  ` +
      `${checkable.length ? ((reconciled.length / checkable.length) * 100).toFixed(0) : 0}%  ` +
      dim(`(of the ${checkable.length} with both a subtotal and a total)`),
  );

  const failed = sample.filter((r) => !r.extracted);
  if (failed.length) {
    console.log();
    console.log("    failures:");
    const byCode = new Map<string, number>();
    for (const f of failed) byCode.set(f.errorCode ?? "?", (byCode.get(f.errorCode ?? "?") ?? 0) + 1);
    for (const [code, count] of byCode) console.log(`      ${code}: ${count}`);
  }

  const currencies = new Map<string, number>();
  for (const r of done) currencies.set(r.currency ?? "null", (currencies.get(r.currency ?? "null") ?? 0) + 1);
  console.log();
  console.log(
    `    currencies: ${[...currencies].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(", ")}`,
  );

  const inTok = done.reduce((a, r) => a + (r.inputTokens ?? 0), 0);
  const outTok = done.reduce((a, r) => a + (r.outputTokens ?? 0), 0);
  console.log(
    dim(
      `    ${inTok} in / ${outTok} out tokens · mean ${Math.round(done.reduce((a, r) => a + (r.totalMs ?? 0), 0) / (done.length || 1))}ms per receipt`,
    ),
  );
  console.log();
}

if (outFile) {
  await writeFile(outFile, rows.map((r) => JSON.stringify(r)).join("\n"));
  console.log(dim(`  wrote ${rows.length} rows to ${outFile}`));
  console.log();
}

await terminateOcrPool();
