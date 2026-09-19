import "./_env.mjs"; // must stay first — see scripts/_env.mts
/**
 * OCR-only sweep across the fixture set.
 *
 *   npx tsx scripts/ocr-bench.mts
 *
 * Reports confidence and speed per fixture so a preprocessing change can be
 * judged against numbers rather than a hunch about one image.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { preprocessReceipt } from "../lib/ocr/preprocess";
import { recognize, terminateOcrPool } from "../lib/ocr/tesseract";

const DIR = path.resolve("tests/fixtures/receipts");
const files = (await readdir(DIR)).filter((f) => /\.(png|jpe?g)$/i.test(f));

console.log();
console.log(
  `  ${"fixture".padEnd(38)} ${"conf".padStart(6)} ${"words".padStart(6)} ${"pre".padStart(7)} ${"ocr".padStart(8)}`,
);
console.log(`  ${"─".repeat(68)}`);

let total = 0;
for (const f of files.sort()) {
  const buf = await readFile(path.join(DIR, f));

  const t0 = Date.now();
  const pre = await preprocessReceipt(buf);
  const preMs = Date.now() - t0;

  const ocr = await recognize(pre.image);
  total += ocr.confidence;

  const flag = ocr.confidence < 40 ? " ← below gate" : "";
  console.log(
    `  ${f.padEnd(38)} ${ocr.confidence.toFixed(1).padStart(6)} ${String(ocr.words.length).padStart(6)} ${`${preMs}ms`.padStart(7)} ${`${ocr.durationMs}ms`.padStart(8)}${flag}`,
  );
}

console.log(`  ${"─".repeat(68)}`);
console.log(`  mean confidence ${(total / files.length).toFixed(1)}/100 over ${files.length} fixtures`);
console.log();

await terminateOcrPool();
