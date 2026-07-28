/**
 * Generates the fixture receipt set.
 *
 *   npx tsx scripts/make-fixtures.ts
 *
 * Spec §12 puts fixtures in phase 3 rather than phase 7 on purpose: without
 * them every prompt change is a guess, and you cannot tell a real improvement
 * from a lucky sample. These synthetic receipts are not a substitute for
 * photographs of real crumpled paper — they are the floor, not the ceiling.
 * Each is emitted clean and then deliberately degraded, because a pipeline
 * that only survives crisp input has not been tested at all.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const OUT = path.resolve("tests/fixtures/receipts");

type Receipt = {
  slug: string;
  header: string[];
  items: Array<[string, string]>;
  totals: Array<[string, string]>;
  footer: string[];
  /** Hand-written ground truth, in minor units. */
  expect: Record<string, unknown>;
};

const RECEIPTS: Receipt[] = [
  {
    slug: "tesco-groceries",
    header: ["TESCO EXPRESS", "148 HIGH STREET", "LONDON SE1 2QP", "", "24/07/2026  18:42"],
    items: [
      ["OAT MILK 1L", "1.85"],
      ["SOURDOUGH LOAF", "2.40"],
      ["CHEDDAR 200G", "3.75"],
      ["TOMATOES 400G", "1.10"],
      ["FREE RANGE EGGS 6", "2.20"],
    ],
    totals: [
      ["SUBTOTAL", "11.30"],
      ["VAT @ 0%", "0.00"],
      ["TOTAL", "11.30"],
      ["VISA DEBIT", "11.30"],
      ["CARD ****4417", ""],
    ],
    footer: ["THANK YOU FOR SHOPPING", "CLUBCARD POINTS: 11"],
    expect: {
      merchantName: "Tesco Express",
      currency: "GBP",
      subtotal: 1130,
      taxTotal: 0,
      total: 1130,
      lineItemCount: 5,
      category: "groceries",
      paymentMethod: "CARD",
      cardLast4: "4417",
    },
  },
  {
    slug: "pret-cafe",
    header: ["PRET A MANGER", "STORE 0142", "", "23 JUL 2026 12:18"],
    items: [
      ["FLAT WHITE", "3.45"],
      ["CHICKEN CAESAR BAGUETTE", "4.95"],
      ["ORANGE JUICE", "2.35"],
    ],
    totals: [
      ["SUBTOTAL", "10.75"],
      ["VAT 20%", "2.15"],
      ["SERVICE 10%", "1.08"],
      ["TOTAL", "13.98"],
    ],
    footer: ["EAT IN", "VAT NO 238 4471 22"],
    expect: {
      merchantName: "Pret A Manger",
      currency: "GBP",
      subtotal: 1075,
      taxTotal: 215,
      tipTotal: 108,
      total: 1398,
      lineItemCount: 3,
      category: "restaurants",
    },
  },
  {
    slug: "shell-fuel",
    header: ["SHELL", "A34 SERVICES", "OXFORD OX2 8JU", "", "22/07/2026 07:55"],
    items: [
      ["UNLEADED 41.22L @ 1.459", "60.14"],
      ["MEAL DEAL", "3.99"],
    ],
    totals: [
      ["SUBTOTAL", "64.13"],
      ["VAT", "10.69"],
      ["TOTAL", "64.13"],
      ["MASTERCARD ****8802", ""],
    ],
    footer: ["PUMP 4", "KEEP RECEIPT FOR EXPENSES"],
    expect: {
      merchantName: "Shell",
      currency: "GBP",
      subtotal: 6413,
      total: 6413,
      lineItemCount: 2,
      category: "fuel",
      note: "VAT is included in the total here, not added — a classic reconciliation trap.",
    },
  },
];

function html(r: Receipt): string {
  const row = (l: string, v: string) =>
    `<div class="row"><span>${l}</span><span>${v}</span></div>`;

  return `<!doctype html><meta charset="utf-8">
<style>
  @page { margin: 0 }
  body { margin: 0; background: #fff; }
  .paper {
    width: 380px; padding: 28px 26px 40px;
    font: 15px/1.55 "Courier New", monospace;
    color: #111; background: #fff;
  }
  .c { text-align: center }
  .big { font-size: 19px; font-weight: 700; letter-spacing: 1px }
  .row { display: flex; justify-content: space-between; gap: 12px }
  .sep { border-top: 1px dashed #444; margin: 10px 0 }
  .tot { font-weight: 700 }
</style>
<div class="paper">
  <div class="c big">${r.header[0]}</div>
  ${r.header.slice(1).map((l) => `<div class="c">${l || "&nbsp;"}</div>`).join("")}
  <div class="sep"></div>
  ${r.items.map(([l, v]) => row(l, v)).join("")}
  <div class="sep"></div>
  ${r.totals.map(([l, v], i) => `<div class="${i === r.totals.findIndex((t) => t[0] === "TOTAL") ? "tot" : ""}">${row(l, v)}</div>`).join("")}
  <div class="sep"></div>
  ${r.footer.map((l) => `<div class="c">${l}</div>`).join("")}
</div>`;
}

/** Thermal paper: warm-grey, low contrast, slightly soft. */
async function degradeThermal(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .linear(0.62, 58) // crush contrast toward mid-grey
    .tint({ r: 250, g: 247, b: 236 })
    .blur(0.6)
    .jpeg({ quality: 62 }) // compression artefacts, as from a phone camera
    .toBuffer();
}

/** Handheld photo: off-axis, uneven exposure, slight motion blur. */
async function degradeAngled(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate(4.5, { background: { r: 42, g: 44, b: 46 } })
    .linear(0.85, 12)
    .blur(0.9)
    .jpeg({ quality: 70 })
    .toBuffer();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const r of RECEIPTS) {
  await page.setContent(html(r), { waitUntil: "load" });
  const el = await page.locator(".paper").first();
  const clean = await el.screenshot({ type: "png" });

  await writeFile(path.join(OUT, `${r.slug}.png`), clean);
  await writeFile(path.join(OUT, `${r.slug}--thermal.jpg`), await degradeThermal(clean));
  await writeFile(path.join(OUT, `${r.slug}--angled.jpg`), await degradeAngled(clean));
  await writeFile(
    path.join(OUT, `${r.slug}.expected.json`),
    JSON.stringify(r.expect, null, 2),
  );

  console.log(`  ${r.slug}  (clean + thermal + angled)`);
}

await browser.close();
console.log(`\n  ${RECEIPTS.length * 3} fixtures written to ${OUT}`);
