/**
 * Loads .env for standalone scripts.
 *
 * Next.js does this automatically; a bare `tsx` process does not. This must be
 * the FIRST import in any script that touches lib/env.ts — ES module imports
 * are evaluated in source order, so anything above it would read a bare
 * environment and abort at the validation gate.
 */
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
