import assert from "node:assert/strict";
import { matchReceipt, type Candidate } from "./match";

/* ============================================================
   `pnpm check` part three: which payment a receipt belongs to.

   The rule being defended is that Nori attaches a receipt by itself
   only when one payment fits and nothing else comes close. Every
   case below is one way that can go wrong.
   ============================================================ */

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("  ok  " + name);
};

let n = 0;
const tx = (day: string, pounds: number, name: string): Candidate => ({ id: "tx" + ++n, day, amount: -Math.round(pounds * 100), merchantName: name, description: name.toUpperCase() });

const feed = [tx("2026-09-10", 12.4, "Tesco"), tx("2026-09-11", 4.5, "Greggs"), tx("2026-09-12", 31.6, "Deliveroo"), tx("2026-09-14", 12.4, "Tesco")];

ok("the total and the day pick it out", () => {
  const r = matchReceipt({ total: 3160, purchasedAt: "2026-09-12", merchant: "Deliveroo", seenOn: "2026-09-12" }, feed);
  assert.equal(r.pick, "tx3");
});

ok("a card payment recorded two days later is still the same receipt", () => {
  const r = matchReceipt({ total: 450, purchasedAt: "2026-09-09", merchant: "Greggs", seenOn: "2026-09-11" }, feed);
  assert.equal(r.pick, "tx2");
});

ok("two identical amounts days apart are never guessed between", () => {
  /* £12.40 at Tesco on the 10th and again on the 14th. A receipt
   * dated the 12th is equally close to both: it waits. */
  const r = matchReceipt({ total: 1240, purchasedAt: "2026-09-12", merchant: "Tesco", seenOn: "2026-09-12" }, feed);
  assert.equal(r.pick, null);
  assert.equal(r.ranked.length, 2);
  assert.ok(r.ranked.every((x) => x.exact));
});

ok("but the same pair is decided when the receipt has a date of its own", () => {
  const r = matchReceipt({ total: 1240, purchasedAt: "2026-09-10", merchant: "Tesco", seenOn: "2026-09-15" }, feed);
  assert.equal(r.pick, "tx1");
});

ok("a total that is not in the feed attaches to nothing", () => {
  const r = matchReceipt({ total: 999, purchasedAt: "2026-09-12", merchant: "Tesco", seenOn: "2026-09-12" }, feed);
  assert.equal(r.pick, null);
  assert.equal(r.ranked.length, 0);
});

ok("a penny of rounding is fine, fifty pence is another payment", () => {
  const close = matchReceipt({ total: 3159, purchasedAt: "2026-09-12", merchant: "Deliveroo", seenOn: "2026-09-12" }, feed);
  assert.equal(close.pick, "tx3");
  const far = matchReceipt({ total: 3110, purchasedAt: "2026-09-12", merchant: "Deliveroo", seenOn: "2026-09-12" }, feed);
  assert.equal(far.pick, null, "close on amount is offered, never chosen");
  assert.equal(far.ranked[0]?.id, "tx3");
});

ok("an unreadable date falls back to the day it was photographed", () => {
  const r = matchReceipt({ total: 3160, purchasedAt: null, merchant: null, seenOn: "2026-09-13" }, feed);
  assert.equal(r.pick, "tx3");
});

ok("the shop name breaks a tie the dates cannot", () => {
  const twins = [tx("2026-09-12", 20, "Boots"), tx("2026-09-12", 20, "Superdrug")];
  const r = matchReceipt({ total: 2000, purchasedAt: "2026-09-12", merchant: "Superdrug", seenOn: "2026-09-12" }, twins);
  assert.equal(r.pick, twins[1].id);
});

ok("money coming in is never a receipt's payment", () => {
  const refund: Candidate = { id: "in1", day: "2026-09-12", amount: 3160, merchantName: "Deliveroo", description: "DELIVEROO" };
  const r = matchReceipt({ total: 3160, purchasedAt: "2026-09-12", merchant: "Deliveroo", seenOn: "2026-09-12" }, [refund]);
  assert.equal(r.pick, null);
  assert.equal(r.ranked.length, 0);
});

console.log(`\n  ${passed} checks passed`);
