import "@/env";
import { getConnection } from "./oauth";
import { syncOnce } from "./sync";

/* ============================================================
   `pnpm sync`: what the five-minute timer runs.

   Exits 0 when Monzo is not connected yet, on purpose. A timer that
   fails every five minutes for a job that cannot work yet is a red
   light on Sentry that means nothing, and a light that always means
   nothing trains you to ignore it. (Warden learned this.)

   `pnpm sync --full` walks the whole history again. After the first
   five minutes Monzo only serves 90 days, so this is only useful in
   that window or to repair the last 90 days.
   ============================================================ */

async function main() {
  const conn = await getConnection();
  if (!conn) {
    console.log("nori-sync: Monzo is not connected yet, nothing to do");
    process.exit(0);
  }
  if (!conn.approvedAt) {
    console.log("nori-sync: waiting for the first sync after approval in the Monzo app");
    process.exit(0);
  }
  const mode = process.argv.includes("--full") ? "full" : "recent";
  const r = await syncOnce(mode);
  if (r === "busy") {
    console.log("nori-sync: another sync is running, skipped");
    process.exit(0);
  }
  console.log(`nori-sync: ${r.mode}, ${r.fetched} transactions read`);
  process.exit(0);
}

main().catch((e) => {
  console.error("nori-sync failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
