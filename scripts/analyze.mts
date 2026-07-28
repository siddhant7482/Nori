/**
 * Run the pipeline against an image file, straight from the terminal.
 *
 *   npx tsx scripts/analyze.ts tests/fixtures/receipts/tesco.png
 *   npx tsx scripts/analyze.ts <image> --ocr-only
 *   npx tsx scripts/analyze.ts <image> --json > out.json
 *
 * This is the loop you actually iterate prompts in — the UI is far too slow a
 * feedback cycle for tuning extraction, and going through it hides the OCR
 * text that explains most bad results.
 */
import "./_env.mjs"; // must stay first — see scripts/_env.mts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeReceipt } from "../lib/pipeline/analyze";
import { terminateOcrPool } from "../lib/ocr/tesseract";
import { formatMoney } from "../lib/money";
import { categoryBySlug } from "../lib/categories";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const jsonOut = args.includes("--json");
const ocrOnly = args.includes("--ocr-only");
const showText = args.includes("--text") || ocrOnly;
const forcePath = args.includes("--vision")
  ? ("vision" as const)
  : args.includes("--text-path")
    ? ("text" as const)
    : undefined;

if (!file) {
  console.error(
    "usage: tsx scripts/analyze.mts <image> [--json] [--text] [--ocr-only] [--vision|--text-path]",
  );
  process.exit(1);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

if (ocrOnly) process.env.OPENROUTER_API_KEY = "";

const buf = await readFile(path.resolve(file));

const result = await analyzeReceipt(buf, {
  forcePath,
  onStage: (e) => {
    if (!jsonOut && e.stage !== "done" && e.stage !== "failed") {
      console.error(dim(`  ${String(e.elapsedMs).padStart(6)}ms  ${e.label}`));
    }
  },
});

if (jsonOut) {
  // Word boxes are enormous and drown the useful output; keep the count only.
  console.log(
    JSON.stringify(
      { ...result, ocr: { ...result.ocr, words: result.ocr.words.length } },
      null,
      2,
    ),
  );
  await terminateOcrPool();
  process.exit(result.ok ? 0 : 1);
}

console.log();
console.log(bold(`  ${path.basename(file)}`));
console.log(
  dim(
    `  ${result.ocr.width}×${result.ocr.height}px · OCR confidence ${result.ocr.confidence.toFixed(1)}/100 · ${result.ocr.words.length} words`,
  ),
);

if (showText) {
  console.log();
  console.log(dim("  ── OCR text ──────────────────────────────"));
  for (const line of result.ocr.text.split("\n")) {
    if (line.trim()) console.log(dim(`  │ `) + line);
  }
  console.log(dim("  ──────────────────────────────────────────"));
}

if (!result.ok) {
  console.log();
  console.log(`  ${red("✗")} ${bold(result.errorCode ?? "FAILED")}`);
  console.log(`    ${result.errorMessage}`);
  console.log();
  await terminateOcrPool();
  process.exit(1);
}

const r = result.receipt!;
const cur = r.currency ?? "GBP";
const cat = categoryBySlug(r.category);
const money = (v: number | null) => (v === null ? dim("—") : formatMoney(v, cur));

console.log();
console.log(`  ${bold("Merchant")}   ${r.merchantName ?? dim("—")}`);
console.log(`  ${bold("Date")}       ${r.purchasedAt ?? dim("—")}`);
console.log(`  ${bold("Category")}   ${cat ? `${cat.icon} ${cat.name}` : dim("—")}`);
if (r.categoryReason) console.log(dim(`             ${r.categoryReason}`));

if (r.lineItems.length) {
  console.log();
  for (const li of r.lineItems) {
    const qty = li.quantity !== 1 ? dim(` ×${li.quantity}`) : "";
    console.log(
      `    ${li.description.slice(0, 38).padEnd(38)}${qty} ${formatMoney(li.total, cur).padStart(10)}`,
    );
  }
}

console.log();
console.log(`    ${"Subtotal".padEnd(38)}  ${money(r.subtotal).padStart(10)}`);
console.log(`    ${"Tax".padEnd(38)}  ${money(r.taxTotal).padStart(10)}`);
if (r.tipTotal) console.log(`    ${"Tip".padEnd(38)}  ${money(r.tipTotal).padStart(10)}`);
console.log(`    ${bold("Total".padEnd(38))}  ${bold(money(r.total).padStart(10))}`);

if (result.warnings.length) {
  console.log();
  for (const w of result.warnings) {
    const mark = w.severity === "error" ? red("✗") : amber("!");
    console.log(`  ${mark} ${dim(`[${w.field}]`)} ${w.message}`);
  }
} else {
  console.log();
  console.log(`  ${green("✓")} All checks passed`);
}

console.log();
console.log(
  dim(`  path: ${result.path} — ${result.pathReason}`),
);
console.log(
  dim(
    `  ${result.usage?.model} · ${result.usage?.inputTokens}→${result.usage?.outputTokens} tokens · ` +
      Object.entries(result.timings)
        .map(([k, v]) => `${k} ${v}ms`)
        .join(" · "),
  ),
);
console.log();

await terminateOcrPool();
