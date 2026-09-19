import "./_env.mjs"; // must stay first — see scripts/_env.mts
/**
 * Scores the pipeline against hand-written ground truth.
 *
 *   npx tsx scripts/eval.mts
 *   npx tsx scripts/eval.mts --filter thermal
 *
 * This is the only honest way to judge a prompt change. Eyeballing one receipt
 * cannot distinguish a real improvement from a lucky sample, and extraction
 * regressions are silent — the output still looks like a valid receipt.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeReceipt } from "../lib/pipeline/analyze";
import { terminateOcrPool } from "../lib/ocr/tesseract";

const DIR = path.resolve("tests/fixtures/receipts");
const filterArg = process.argv.indexOf("--filter");
const filter = filterArg >= 0 ? process.argv[filterArg + 1] : null;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;

type Truth = Record<string, unknown>;

/** Merchant names vary in casing and suffixes; compare loosely. */
function nameMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(actual);
  const e = norm(expected);
  return a.includes(e) || e.includes(a);
}

const files = (await readdir(DIR))
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .filter((f) => !filter || f.includes(filter))
  .sort();

type Row = {
  file: string;
  ok: boolean;
  passed: number;
  total: number;
  failures: string[];
  warnings: number;
  ms: number;
  note?: string;
};

const rows: Row[] = [];

for (const file of files) {
  const slug = file.replace(/--(thermal|angled)/, "").replace(/\.(png|jpe?g)$/i, "");
  let truth: Truth;
  try {
    truth = JSON.parse(await readFile(path.join(DIR, `${slug}.expected.json`), "utf8"));
  } catch {
    console.log(dim(`  skipping ${file} — no ${slug}.expected.json`));
    continue;
  }

  const buf = await readFile(path.join(DIR, file));
  const t0 = Date.now();
  const result = await analyzeReceipt(buf);
  const ms = Date.now() - t0;

  if (!result.ok || !result.receipt) {
    rows.push({
      file,
      ok: false,
      passed: 0,
      total: 1,
      failures: [`pipeline: ${result.errorCode} — ${result.errorMessage}`],
      warnings: 0,
      ms,
    });
    continue;
  }

  const r = result.receipt;
  const checks: Array<[string, boolean, string]> = [];

  const check = (name: string, pass: boolean, detail: string) =>
    checks.push([name, pass, detail]);

  if (truth.merchantName)
    check(
      "merchant",
      nameMatches(r.merchantName, truth.merchantName as string),
      `${r.merchantName} ≠ ${truth.merchantName}`,
    );
  if (truth.currency)
    check("currency", r.currency === truth.currency, `${r.currency} ≠ ${truth.currency}`);
  for (const key of ["subtotal", "taxTotal", "tipTotal", "total"] as const) {
    if (truth[key] !== undefined)
      check(key, r[key] === truth[key], `${r[key]} ≠ ${truth[key]}`);
  }
  if (truth.category)
    check("category", r.category === truth.category, `${r.category} ≠ ${truth.category}`);
  if (truth.lineItemCount !== undefined)
    check(
      "lineItems",
      r.lineItems.length === truth.lineItemCount,
      `${r.lineItems.length} ≠ ${truth.lineItemCount}`,
    );
  if (truth.paymentMethod)
    check(
      "payment",
      r.paymentMethod === truth.paymentMethod,
      `${r.paymentMethod} ≠ ${truth.paymentMethod}`,
    );
  if (truth.cardLast4)
    check("cardLast4", r.cardLast4 === truth.cardLast4, `${r.cardLast4} ≠ ${truth.cardLast4}`);

  const passed = checks.filter(([, p]) => p).length;
  rows.push({
    file,
    ok: passed === checks.length,
    passed,
    total: checks.length,
    failures: checks.filter(([, p]) => !p).map(([n, , d]) => `${n}: ${d}`),
    warnings: result.warnings.length,
    ms,
    note: truth.note as string | undefined,
  });
}

console.log();
console.log(bold("  Extraction accuracy against ground truth"));
console.log();

let totalPassed = 0;
let totalChecks = 0;

for (const row of rows) {
  totalPassed += row.passed;
  totalChecks += row.total;

  const mark = row.ok ? green("✓") : red("✗");
  const score = `${row.passed}/${row.total}`;
  console.log(
    `  ${mark} ${row.file.padEnd(34)} ${score.padStart(6)}  ${dim(`${row.warnings} warn · ${(row.ms / 1000).toFixed(1)}s`)}`,
  );
  for (const f of row.failures) console.log(`      ${red("·")} ${f}`);
  if (row.note && !row.ok) console.log(`      ${dim(row.note)}`);
}

const pct = totalChecks ? (totalPassed / totalChecks) * 100 : 0;
console.log();
console.log(
  `  ${bold(`${totalPassed}/${totalChecks} field checks passed`)} (${pct.toFixed(1)}%) across ${rows.length} fixtures`,
);
console.log(
  dim(`  ${rows.filter((r) => r.ok).length}/${rows.length} fixtures fully correct`),
);
console.log();

if (pct < 100) {
  console.log(
    amber(
      "  Note: a failure here can be OCR corruption rather than a bad prompt.\n" +
        "  Check the raw text with `npm run analyze <file> -- --text` before touching the prompt.",
    ),
  );
  console.log();
}

await terminateOcrPool();
