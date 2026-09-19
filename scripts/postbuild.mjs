import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/* ============================================================
   The step Next does not do for the standalone output.

   .next/static and public/ are left out on purpose, expecting a Docker
   COPY. Skipping them does not fail the build or warn: the HTML renders
   and every stylesheet 404s. The hub lost its CSS exactly this way, so
   every CommandHQ app assembles its own standalone output as part of
   `pnpm build` rather than trusting a deploy script to remember.
   ============================================================ */

const SA = ".next/standalone";

if (!existsSync(SA)) {
  console.log("postbuild: no standalone output, nothing to assemble");
  process.exit(0);
}

const replace = (from, to) => {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
};

replace(".next/static", join(SA, ".next/static"));
console.log("postbuild: .next/static");

if (existsSync("public")) {
  replace("public", join(SA, "public"));
  console.log("postbuild: public");
}

/* sharp's native half (libvips) is NOT traced into standalone: tracing
 * finds the .node loader but not the shared library it loads, which
 * builds cleanly and then fails on the first receipt. The packages are
 * copied whole, with pnpm's symlinks kept as symlinks, because on Linux
 * libvips is a separate package linked in beside the loader. (Vault
 * learned this the hard way; the glob that looks like the fix crashes
 * Turbopack.) */
const PNPM = "node_modules/.pnpm";
const natives = existsSync(PNPM) ? readdirSync(PNPM).filter((d) => d.startsWith("@img+sharp-")) : [];
for (const d of natives) replace(join(PNPM, d), join(SA, PNPM, d));
console.log(`postbuild: sharp natives · ${natives.join(", ") || "none found"}`);
