import assert from "node:assert/strict";
import { EXAMPLE_CATEGORIES } from "@/db/example";
import { computeMonth } from "./month";
import { cycleFor } from "./payday";
import { doubleCharges, findRecurring, stillDue, type RecurIn } from "./recurring";

/* ============================================================
   `pnpm check` part two: what is still due, and what changed.

   Hand-built payees rather than the example cycle, because each case
   here is a specific claim: this is a bill, that is a shop you happen
   to visit, this one was cancelled, that one went up.
   ============================================================ */

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("  ok  " + name);
};

const TODAY = "2026-09-12";
let n = 0;
const tx = (day: string, pounds: number, label: string, opts: Partial<RecurIn> = {}): RecurIn => ({
  id: "t" + ++n,
  day,
  created: new Date(day + "T09:00:00Z"),
  amount: -Math.round(pounds * 100),
  kind: "spend",
  categoryId: opts.categoryId ?? null,
  description: label.toUpperCase(),
  merchantGroupId: opts.merchantGroupId ?? null,
  merchantName: opts.merchantName ?? null,
  counterpartyName: opts.counterpartyName ?? label,
  ...opts,
});

const rent = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((d) => tx(d, 950, "J Patel", { categoryId: "bills" }));
/* Netflix took £10.99 four times, then £12.99. */
const netflix = ["2026-05-29", "2026-06-29", "2026-07-29"].map((d) => tx(d, 10.99, "Netflix", { merchantGroupId: "grp_netflix", merchantName: "Netflix" }));
netflix.push(tx("2026-08-29", 12.99, "Netflix", { merchantGroupId: "grp_netflix", merchantName: "Netflix" }));
const cleaner = ["2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04", "2026-09-11"].map((d) => tx(d, 40, "H Okafor"));
/* A shop, not a bill: whenever, and never the same amount. */
const tesco = [["2026-08-03", 12.4], ["2026-08-09", 41.2], ["2026-08-17", 8.75], ["2026-08-30", 63.1], ["2026-09-05", 22.05]].map(([d, p]) => tx(d as string, p as number, "Tesco", { merchantGroupId: "grp_tesco", merchantName: "Tesco" }));
/* Cancelled in June: three payments, then nothing for three months. */
const gym = ["2026-04-06", "2026-05-06", "2026-06-06"].map((d) => tx(d, 32, "PureGym", { merchantGroupId: "grp_gym", merchantName: "PureGym" }));
const all = [...rent, ...netflix, ...cleaner, ...tesco, ...gym];

const series = findRecurring(all, TODAY);
const by = (label: string) => series.find((s) => s.label === label);

ok("rent is monthly, and the next one is due on the 1st", () => {
  const r = by("J Patel")!;
  assert.equal(r.cadence, "monthly");
  assert.equal(r.typical, 95000);
  assert.equal(r.due, "2026-10-01");
  assert.equal(r.seen, 6);
  assert.equal(r.changed, null);
});

ok("a weekly payment is weekly", () => {
  const c = by("H Okafor")!;
  assert.equal(c.cadence, "weekly");
  assert.equal(c.every, 7);
  assert.equal(c.due, "2026-09-18");
});

ok("Netflix going from £10.99 to £12.99 is noticed, with both figures", () => {
  const s = by("Netflix")!;
  assert.deepEqual(s.changed, { from: 1099, to: 1299, at: "2026-08-29", pct: 18 });
  assert.equal(s.typical, 1299, "the new price is what to expect next time");
  assert.equal(s.due, "2026-09-29");
});

ok("a supermarket you visit whenever is not a bill", () => {
  assert.equal(by("Tesco"), undefined);
});

ok("a cancelled gym stops being expected", () => {
  assert.equal(by("PureGym"), undefined);
});

/* --- what is still due before payday --- */
const cycle = cycleFor(TODAY, { payer: "ACME", amount: 276000, days: ["2026-08-25"], amounts: [276000], rule: { kind: "dom", dom: 25 } });
ok("before payday: the cleaner once more, not October's rent, not the 29th", () => {
  const due = stillDue(series, TODAY, cycle.end);
  assert.deepEqual(due.map((d) => `${d.series.label} ${d.due}`), ["H Okafor 2026-09-18"]);
  const labels = due.map((d) => d.series.label);
  assert.ok(labels.includes("H Okafor"), "the weekly cleaner");
  assert.ok(!labels.includes("J Patel"), "October's rent is next cycle's problem");
  assert.ok(!labels.includes("Netflix"), "the 29th is after payday");
});

ok("a bill that should have arrived and has not stays on the list", () => {
  const late = findRecurring([...rent.slice(0, 5), tx("2026-09-01", 950, "J Patel", { categoryId: "bills" })], "2026-10-04");
  const due = stillDue(late, "2026-10-04", "2026-10-24");
  const r = due.find((d) => d.series.label === "J Patel")!;
  assert.ok(r.overdue, "due on the 1st, not seen, still expected");
  assert.equal(r.amount, 95000);
});

ok("once it has arrived it is not still due", () => {
  /* The 1 September rent is in the data, so the next one is October's
   * and this cycle owes the landlord nothing. */
  const due = stillDue(series, "2026-09-02", "2026-09-24");
  assert.ok(!due.some((d) => d.series.label === "J Patel"));
});

ok("a payee with a pass AND top-ups keeps them apart", () => {
  /* The real shape, from a real account: a travel pass every four
   * weeks, plus top-ups whenever. Lumped together the amounts look
   * random and the pass is lost. */
  const pass = ["2026-06-16", "2026-07-14", "2026-08-11", "2026-09-08"].map((d) => tx(d, 35.7, "Nexus", { merchantGroupId: "grp_nexus", merchantName: "Nexus" }));
  const topups = ["2026-06-20", "2026-08-19", "2026-09-09"].map((d) => tx(d, 5, "Nexus", { merchantGroupId: "grp_nexus", merchantName: "Nexus" }));
  const found = findRecurring([...pass, ...topups], "2026-09-12");
  const four = found.find((s) => s.typical === 3570)!;
  assert.equal(four.cadence, "four-weekly");
  assert.equal(four.due, "2026-10-06");
  assert.ok(!found.some((s) => s.typical === 500), "the ad-hoc top-ups are not a schedule");
});

/* --- the daily number holds it back --- */
const cats = EXAMPLE_CATEGORIES.map((c) => ({ ...c }));
const base = computeMonth({ cats, txs: [], cycle, today: TODAY });
const withDue = computeMonth({
  cats,
  txs: [],
  cycle,
  today: TODAY,
  due: [
    { series: { ...by("H Okafor")!, categoryId: "groc" }, due: "2026-09-18", amount: 4000, overdue: false },
    { series: { ...by("J Patel")!, categoryId: "bills" }, due: "2026-09-20", amount: 95000, overdue: false },
  ],
});
ok("£40 still due from groceries is reserved; £950 of rent is not in the daily number at all", () => {
  assert.equal(base.leftADay, 6077); // 79000 / 13
  assert.equal(withDue.leftADayBefore, 6077);
  assert.equal(withDue.leftADay, 5769); // (79000 - 4000) / 13
  assert.equal(withDue.reserved, 4000);
  assert.equal(withDue.committed, 99000);
  assert.equal(withDue.cats.find((c) => c.id === "groc")!.due, 4000);
  assert.equal(withDue.cats.find((c) => c.id === "groc")!.perDayLeft, 2154); // (32000 - 4000) / 13
});

/* --- charged twice --- */
ok("the same shop taking the same amount twice within the hour is caught", () => {
  const a = tx("2026-09-10", 24.99, "Amazon", { merchantGroupId: "grp_amz", merchantName: "Amazon" });
  const b = { ...tx("2026-09-10", 24.99, "Amazon", { merchantGroupId: "grp_amz", merchantName: "Amazon" }), created: new Date("2026-09-10T09:30:00Z") };
  const far = { ...tx("2026-09-11", 24.99, "Amazon", { merchantGroupId: "grp_amz", merchantName: "Amazon" }), created: new Date("2026-09-11T18:00:00Z") };
  const hits = doubleCharges([a, b, far], "2026-08-25");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].amount, 2499);
  assert.equal(hits[0].ids.length, 2);
});

console.log(`\n  ${passed} checks passed`);
