import { cpSync, existsSync, rmSync } from "node:fs";
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
