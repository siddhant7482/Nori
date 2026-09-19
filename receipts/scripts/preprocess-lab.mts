import "./_env.mjs"; // must stay first — see scripts/_env.mts
/**
 * A/B harness for preprocessing changes.
 *
 *   npx tsx scripts/preprocess-lab.mts --n 40
 *
 * Preprocessing is where OCR accuracy is actually won (spec §6.1), and it is
 * impossible to judge a change by looking at one image. This runs every
 * candidate over the same sample and prints mean confidence side by side.
 *
 * Findings from the real-receipt set are what motivated the variants below:
 * thermal printers commonly use blue or violet ink, and `.greyscale()`
 * averages the channels — close to the worst possible transform for blue ink
 * on white paper. Taking the RED channel instead pushes blue ink dark while
 * leaving black ink essentially unchanged.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { recognize, terminateOcrPool } from "../lib/ocr/tesseract";

const argv = process.argv.slice(2);
const nArg = argv.indexOf("--n");
const N = nArg >= 0 ? Number(argv[nArg + 1]) : 30;
const DIR = path.resolve("receipts_train");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const TARGET_HEIGHT = 2000;
const MIN_HEIGHT = 900;

function base(input: Buffer) {
  return sharp(input, { failOn: "none" }).rotate();
}

async function sized(input: Buffer) {
  const meta = await base(input).metadata();
  const h = Math.min(Math.max(meta.height ?? MIN_HEIGHT, MIN_HEIGHT), TARGET_HEIGHT);
  return { h, upscale: (meta.height ?? 0) < MIN_HEIGHT };
}

type Variant = {
  name: string;
  run: (input: Buffer) => Promise<Buffer>;
};

const VARIANTS: Variant[] = [
  {
    name: "current (greyscale)",
    run: async (input) => {
      const { h, upscale } = await sized(input);
      return base(input)
        .resize({ height: h, fit: "inside", withoutEnlargement: !upscale, kernel: "lanczos3" })
        .greyscale()
        .normalise()
        .sharpen({ sigma: 1 })
        .png()
        .toBuffer();
    },
  },
  {
    name: "red channel",
    run: async (input) => {
      const { h, upscale } = await sized(input);
      return base(input)
        .resize({ height: h, fit: "inside", withoutEnlargement: !upscale, kernel: "lanczos3" })
        .extractChannel("red")
        .normalise()
        .sharpen({ sigma: 1 })
        .png()
        .toBuffer();
    },
  },
  {
    name: "red + linear boost",
    run: async (input) => {
      const { h, upscale } = await sized(input);
      return base(input)
        .resize({ height: h, fit: "inside", withoutEnlargement: !upscale, kernel: "lanczos3" })
        .extractChannel("red")
        .normalise()
        .linear(1.35, -35) // push mid-greys apart: pale ink darker, paper whiter
        .sharpen({ sigma: 1 })
        .png()
        .toBuffer();
    },
  },
  {
    name: "red + clahe",
    run: async (input) => {
      const { h, upscale } = await sized(input);
      return base(input)
        .resize({ height: h, fit: "inside", withoutEnlargement: !upscale, kernel: "lanczos3" })
        .extractChannel("red")
        // Local contrast: handles the uneven lighting of a handheld photo,
        // where one corner is in shadow and the other is blown out.
        .clahe({ width: 64, height: 64, maxSlope: 3 })
        .sharpen({ sigma: 1 })
        .png()
        .toBuffer();
    },
  },
  {
    name: "grey + clahe",
    run: async (input) => {
      const { h, upscale } = await sized(input);
      return base(input)
        .resize({ height: h, fit: "inside", withoutEnlargement: !upscale, kernel: "lanczos3" })
        .greyscale()
        .clahe({ width: 64, height: 64, maxSlope: 3 })
        .sharpen({ sigma: 1 })
        .png()
        .toBuffer();
    },
  },
];

// Stratified sample across the whole difficulty range, not just easy images.
const all = (await readdir(DIR)).filter((f) => /\.jpe?g$/i.test(f)).sort();
const usable: string[] = [];
for (const f of all) {
  const b = await readFile(path.join(DIR, f));
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) usable.push(f);
}
const stride = Math.max(1, Math.floor(usable.length / N));
const sample = Array.from({ length: N }, (_, i) => usable[i * stride]).filter(Boolean);

console.log();
console.log(bold(`  Preprocessing A/B over ${sample.length} real receipts`));
console.log();

const scores = new Map<string, number[]>();
const times = new Map<string, number>();

for (const [i, f] of sample.entries()) {
  const buf = await readFile(path.join(DIR, f));
  for (const v of VARIANTS) {
    const t0 = Date.now();
    let conf = 0;
    try {
      const img = await v.run(buf);
      const ocr = await recognize(img);
      conf = ocr.confidence;
    } catch {
      conf = 0;
    }
    times.set(v.name, (times.get(v.name) ?? 0) + (Date.now() - t0));
    const arr = scores.get(v.name) ?? [];
    arr.push(conf);
    scores.set(v.name, arr);
  }
  process.stdout.write(`\r  ${i + 1}/${sample.length} images`);
}

console.log("\n");

const baseline = scores.get(VARIANTS[0].name)!;
const baseMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;

console.log(`  ${"variant".padEnd(22)} ${"mean".padStart(7)} ${"delta".padStart(8)} ${"wins".padStart(7)} ${"<40".padStart(5)}`);
console.log(`  ${"─".repeat(56)}`);

for (const v of VARIANTS) {
  const s = scores.get(v.name)!;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const delta = mean - baseMean;
  const wins = s.filter((c, i) => c > baseline[i] + 0.5).length;
  const gated = s.filter((c) => c < 40).length;

  const d =
    v.name === VARIANTS[0].name
      ? dim("  baseline")
      : delta > 0
        ? green(`  +${delta.toFixed(1)}`)
        : red(`  ${delta.toFixed(1)}`);

  console.log(
    `  ${v.name.padEnd(22)} ${mean.toFixed(1).padStart(7)} ${d.padStart(8)} ${String(wins).padStart(7)} ${String(gated).padStart(5)}   ${dim(`${Math.round((times.get(v.name) ?? 0) / sample.length)}ms`)}`,
  );
}

console.log();
await terminateOcrPool();
