import { readFileSync } from "node:fs";
import { hashPassword } from "./session";

/* `pnpm hash-password < file` prints the LOGIN_PASSWORD_HASH for the
 * password on stdin. Reads stdin rather than an argument so the
 * password never lands in shell history or a process list. */
const pw = readFileSync(0, "utf8").replace(/\r?\n$/, "");
if (pw.length < 12) {
  console.error("hash-password: use at least 12 characters");
  process.exit(1);
}
console.log(hashPassword(pw));
