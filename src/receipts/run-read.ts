import "@/env";
import { readReceipt } from "./read";

/* ============================================================
   `pnpm read <id>`: reading a receipt, in its own process.

   Not inside the web server, for three reasons learned the hard way:

   · Tesseract starts a worker from a file path inside node_modules,
     and Next's standalone bundle does not carry it. In the server
     that is an uncaught exception that takes the whole app down with
     it; out here it is one failed receipt.
   · OCR and the wasm it loads want hundreds of megabytes for a few
     seconds. A page render should never be behind that.
   · It can take a minute. Requests should not.

   The route spawns this and the screen polls the row, so a phone
   that walks out of Wi-Fi mid-read still gets its receipt.
   ============================================================ */

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id)) {
    console.error("usage: pnpm read <receipt id>");
    process.exit(2);
  }
  const result = await readReceipt(id);
  console.log(JSON.stringify(result));
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
