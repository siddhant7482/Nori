/**
 * Next.js runs this once per server process, before any request is handled.
 * It is the only hook that fires early enough to make a bad configuration a
 * startup crash rather than a runtime 500 on someone's first upload.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env");
  }
}
