import "./_env.mjs"; // must stay first — see scripts/_env.mts
/**
 * Head-to-head: OCR-text extraction vs vision extraction, same receipts.
 *
 *   npx tsx scripts/bench-paths.mts --n 30
 *
 * Both paths run over an identical stratified sample so the comparison is
 * controlled. Without ground-truth labels the primary metric is the
 * RECONCILIATION RATE — how often the figures a path reports agree with each
 * other arithmetically.
 *
 * Why that is a fair metric: a path that misreads a digit produces components
 * that no longer sum to its own total. It cannot be gamed by guessing, since
 * a guessed total will not agree with guessed parts. It is a lower bound on
 * correctness, not a substitute for labelled data — a path that reads every
 * figure off the wrong receipt entirely would still reconcile.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeReceipt, type ExtractionPath } from "../lib/pipeline/analyze";
import { terminateOcrPool } from "../lib/ocr/tesseract";

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DIR = path.resolve(arg("--dir") ?? "receipts_train");
const N = Number(arg("--n") ?? 24);
const outFile = arg("--out");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const all = (await readdir(DIR)).filter((f) => /\.jpe?g$/i.test(f)).sort();
const usable: string[] = [];
for (const f of all) {
  const b = await readFile(path.join(DIR, f));
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) usable.push(f);
}
const stride = Math.max(1, Math.floor(usable.length / N));
const sample = Array.from({ length: N }, (_, i) => usable[i * stride]).filter(Boolean);

type Outcome = {
  file: string;
  path: ExtractionPath;
  ok: boolean;
  errorCode?: string;
  ocrConfidence: number;
  merchant: string | null;
  currency: string | null;
  date: string | null;
  total: number | null;
  subtotal: number | null;
  lineItems: number;
  category: string | null;
  reconciles: boolean | null;
  warnings: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
};

const results: Outcome[] = [];

console.log();
console.log(bold(`  Text vs vision over ${sample.length} real receipts`));
console.log(dim(`  each receipt is run through both paths`));
console.log();

for (const [i, file] of sample.entries()) {
  const buf = await readFile(path.join(DIR, file));

  for (const p of ["text", "vision"] as const) {
    const t0 = Date.now();
    const res = await analyzeReceipt(buf, { forcePath: p });
    const ms = Date.now() - t0;
    const r = res.receipt;

    const reconciles =
      r && r.total !== null && r.subtotal !== null
        ? Math.abs(r.subtotal + (r.taxTotal ?? 0) + (r.tipTotal ?? 0) - r.total) <= 2 ||
          Math.abs(r.subtotal + (r.tipTotal ?? 0) - r.total) <= 2
        : null;

    results.push({
      file,
      path: p,
      ok: Boolean(res.ok && r),
      errorCode: res.errorCode,
      ocrConfidence: res.ocr.confidence,
      merchant: r?.merchantName ?? null,
      currency: r?.currency ?? null,
      date: r?.purchasedAt ?? null,
      total: r?.total ?? null,
      subtotal: r?.subtotal ?? null,
      lineItems: r?.lineItems.length ?? 0,
      category: r?.category ?? null,
      reconciles,
      warnings: res.warnings.length,
      inputTokens: res.usage?.inputTokens ?? 0,
      outputTokens: res.usage?.outputTokens ?? 0,
      ms,
    });

    process.stdout.write(
      res.ok ? (reconciles === false ? amber("!") : green(".")) : red("x"),
    );
  }
  process.stdout.write(dim("|"));
  if ((i + 1) % 20 === 0) process.stdout.write("\n  ");
}

console.log("\n");

function summarise(p: ExtractionPath) {
  const rows = results.filter((r) => r.path === p);
  const done = rows.filter((r) => r.ok);
  const checkable = done.filter((r) => r.reconciles !== null);
  const reconciled = checkable.filter((r) => r.reconciles);

  return {
    n: rows.length,
    completed: done.length,
    total: done.filter((r) => r.total !== null).length,
    merchant: done.filter((r) => r.merchant).length,
    date: done.filter((r) => r.date).length,
    category: done.filter((r) => r.category).length,
    lineItems: done.reduce((a, r) => a + r.lineItems, 0),
    checkable: checkable.length,
    reconciled: reconciled.length,
    reconRate: checkable.length ? (reconciled.length / checkable.length) * 100 : 0,
    inTok: done.reduce((a, r) => a + r.inputTokens, 0),
    outTok: done.reduce((a, r) => a + r.outputTokens, 0),
    ms: done.length ? done.reduce((a, r) => a + r.ms, 0) / done.length : 0,
  };
}

const t = summarise("text");
const v = summarise("vision");

const row = (label: string, a: string, b: string, better?: "a" | "b") =>
  console.log(
    `  ${label.padEnd(24)} ${(better === "a" ? green(a) : a).padStart(better === "a" ? 18 : 9)} ${(better === "b" ? green(b) : b).padStart(better === "b" ? 20 : 11)}`,
  );

console.log(`  ${"".padEnd(24)} ${"OCR text".padStart(9)} ${"vision".padStart(11)}`);
console.log(`  ${"─".repeat(48)}`);

const pc = (k: number, n: number) => `${((k / n) * 100).toFixed(0)}%`;

row("completed", pc(t.completed, t.n), pc(v.completed, v.n), t.completed > v.completed ? "a" : v.completed > t.completed ? "b" : undefined);
row("total found", pc(t.total, t.n), pc(v.total, v.n), t.total > v.total ? "a" : v.total > t.total ? "b" : undefined);
row("merchant found", pc(t.merchant, t.n), pc(v.merchant, v.n), t.merchant > v.merchant ? "a" : v.merchant > t.merchant ? "b" : undefined);
row("date found", pc(t.date, t.n), pc(v.date, v.n), t.date > v.date ? "a" : v.date > t.date ? "b" : undefined);
row("category assigned", pc(t.category, t.n), pc(v.category, v.n), t.category > v.category ? "a" : v.category > t.category ? "b" : undefined);
row("line items extracted", String(t.lineItems), String(v.lineItems), t.lineItems > v.lineItems ? "a" : v.lineItems > t.lineItems ? "b" : undefined);
console.log();
row(
  "ARITHMETIC RECONCILES",
  `${t.reconciled}/${t.checkable} ${t.reconRate.toFixed(0)}%`,
  `${v.reconciled}/${v.checkable} ${v.reconRate.toFixed(0)}%`,
  t.reconRate > v.reconRate ? "a" : v.reconRate > t.reconRate ? "b" : undefined,
);
console.log();
row("mean latency", `${(t.ms / 1000).toFixed(1)}s`, `${(v.ms / 1000).toFixed(1)}s`, t.ms < v.ms ? "a" : "b");
row("input tokens", String(t.inTok), String(v.inTok), t.inTok < v.inTok ? "a" : "b");
row("output tokens", String(t.outTok), String(v.outTok), t.outTok < v.outTok ? "a" : "b");

// Per-receipt disagreement on the total is the sharpest signal available:
// where the two paths differ, at least one is wrong.
const byFile = new Map<string, Outcome[]>();
for (const r of results) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);

const disagreements = [...byFile.entries()].filter(([, rs]) => {
  const [a, b] = rs;
  return a?.ok && b?.ok && a.total !== b.total;
});

console.log();
console.log(
  `  totals disagree on ${disagreements.length}/${sample.length} receipts` +
    dim(" — at least one path is wrong on each"),
);
for (const [file, rs] of disagreements.slice(0, 12)) {
  const txt = rs.find((r) => r.path === "text")!;
  const vis = rs.find((r) => r.path === "vision")!;
  console.log(
    `    ${file.padEnd(22)} ${dim(`ocr ${txt.ocrConfidence.toFixed(0)}`)}  text=${String(txt.total).padStart(7)} ${txt.reconciles === false ? red("✗") : txt.reconciles ? green("✓") : dim("·")}   vision=${String(vis.total).padStart(7)} ${vis.reconciles === false ? red("✗") : vis.reconciles ? green("✓") : dim("·")}`,
  );
}

console.log();
if (outFile) {
  await writeFile(outFile, results.map((r) => JSON.stringify(r)).join("\n"));
  console.log(dim(`  wrote ${results.length} rows to ${outFile}`));
  console.log();
}

await terminateOcrPool();
