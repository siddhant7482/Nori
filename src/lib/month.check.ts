import assert from "node:assert/strict";
import { EXAMPLE_CATEGORIES, EXAMPLE_TODAY, exampleTransactions } from "@/db/example";
import { afford, affordInput, affordText, catById, computeMonth } from "./month";
import { cycleFor, detectPayday, nextPayDate, payDate } from "./payday";

/* ============================================================
   `pnpm check`: the arithmetic, against figures worked out by hand.

   Every expected number below was computed on paper from the example
   cycle, not copied from the code's own output. If one of these
   fails, the code is wrong until proven otherwise.
   ============================================================ */

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("  ok  " + name);
};

const txs = exampleTransactions();
const credits = txs.filter((t) => t.kind === "income").map((t) => ({ day: t.day, amount: t.amount, payer: t.counterpartyName ?? t.description }));

ok("payday rules put the 25th on the Friday before a weekend", () => {
  assert.equal(payDate({ kind: "dom", dom: 25 }, 2026, 3), "2026-04-24"); // Sat 25 Apr
  assert.equal(payDate({ kind: "dom", dom: 25 }, 2026, 6), "2026-07-24"); // Sat 25 Jul
  assert.equal(payDate({ kind: "dom", dom: 25 }, 2026, 8), "2026-09-25"); // Fri 25 Sep
  assert.equal(payDate({ kind: "lwd" }, 2026, 4), "2026-05-29"); // Sun 31 May -> Fri 29
});

const pay = detectPayday(credits);
ok("the salary is found, and its rule explains all six paydays", () => {
  assert.ok(pay);
  assert.equal(pay.payer, "ACME Studio Ltd");
  assert.deepEqual(pay.rule, { kind: "dom", dom: 25 });
  assert.equal(pay.days.length, 6);
  assert.equal(nextPayDate(pay.rule, "2026-08-25"), "2026-09-25");
});

ok("a monthly £40 from a friend is not mistaken for a salary", () => {
  const friend = ["2026-06-03", "2026-07-03", "2026-08-03"].map((day) => ({ day, amount: 4000, payer: "R Shah" }));
  assert.equal(detectPayday(friend), null);
});

ok("money moved in from your own other bank is not a payday", () => {
  const self = ["2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31"].map((day) => ({ day, amount: 66000, payer: "Siddhant Bhasin" }));
  assert.ok(detectPayday(self, "2026-09-12"), "not knowing the name, it looks like one");
  assert.equal(detectPayday(self, "2026-09-12", "Siddhant Bhasin"), null, "knowing the name, it is a transfer");
});

ok("four monthly transfers then six months of silence is not a salary", () => {
  const stopped = ["2025-11-30", "2025-12-31", "2026-02-02", "2026-03-04", "2026-08-31"].map((day) => ({ day, amount: 100000, payer: "Someone Else" }));
  assert.equal(detectPayday(stopped, "2026-09-12"), null);
});

ok("two salaries are not enough to build a cycle on", () => {
  const two = ["2026-07-25", "2026-08-25"].map((day) => ({ day, amount: 276000, payer: "ACME Studio Ltd" }));
  assert.equal(detectPayday(two, "2026-09-12"), null);
});

const cycle = cycleFor(EXAMPLE_TODAY, pay);
ok("the cycle runs salary to salary: 25 Aug to 24 Sep, day 19 of 31", () => {
  assert.equal(cycle.start, "2026-08-25");
  assert.equal(cycle.end, "2026-09-24");
  assert.equal(cycle.daysIn, 31);
  assert.equal(cycle.dayIndex, 19);
  assert.equal(cycle.daysLeft, 13);
  assert.equal(cycle.late, false);
});

ok("a late salary stretches the cycle instead of dividing by zero", () => {
  const late = cycleFor("2026-09-26", pay);
  assert.equal(late.start, "2026-08-25");
  assert.equal(late.late, true);
  assert.equal(late.daysLeft, 1);
});

const m = computeMonth({ cats: EXAMPLE_CATEGORIES, txs, cycle, today: EXAMPLE_TODAY });
ok("spending per budget, refunds and salaries left out", () => {
  assert.equal(catById(m, "groc")!.spent, 21460);
  assert.equal(catById(m, "eat")!.spent, 26740);
  assert.equal(catById(m, "trans")!.spent, 8820);
  assert.equal(catById(m, "shop")!.spent, 6100);
  assert.equal(catById(m, "bills")!.spent, 109200);
  assert.equal(m.dailySpent, 63120);
  assert.equal(m.dailyLimit, 79000);
});

ok("income and pots are counted, never spent", () => {
  assert.equal(m.income, 276000);
  assert.equal(m.saved, 83000);
});

ok("eating out borrows £67.40 from groceries, the budget with most room", () => {
  assert.deepEqual(m.ious, [{ from: "groc", to: "eat", amount: 6740, day: 12 }]);
  assert.equal(catById(m, "groc")!.eff, 25260);
  assert.equal(catById(m, "eat")!.eff, 26740);
  assert.equal(catById(m, "groc")!.perDayLeft, 292); // 3800 / 13 = 292.3
});

ok("the daily number: £158.80 over thirteen days is £12.22", () => {
  assert.equal(m.leftADay, 1222); // 15880 / 13 = 1221.5
  assert.equal(m.allow, 2548); // 79000 / 31
  assert.equal(m.proj, 102985); // 63120 / 19 * 31 = 102985.3
});

ok("three payments are unfiled, £26.69 between them", () => {
  assert.equal(m.unfiled.length, 3);
  assert.equal(m.unfiledTotal, 2669);
});

ok("the voice names the IOU", () => {
  assert.equal(m.said.direct.head, "Eating out is £67.40 over, with thirteen days to payday.");
  assert.match(m.said.direct.body, /came out of groceries, which now has £2\.92 a day until the 25th/);
  assert.match(m.said.warden.body, /for fuck's sake/);
});

ok("a £60 dinner needs an IOU from shopping and leaves £7.60 a day", () => {
  const r = afford(affordInput(m), 6000, "eat");
  assert.ok(r && r.kind === "iou");
  assert.equal(r.after, 760); // (15880 - 6000) / 13
  assert.equal(r.lender, "Shopping");
  assert.equal(r.need, 6000);
  assert.equal(r.lenderAfter, 223); // (8900 - 6000) / 13
  assert.match(affordText(r, "direct", cycle.daysLeft), /a second IOU/);
});

ok("£200 is more than everything left", () => {
  const r = afford(affordInput(m), 20000, null);
  assert.ok(r && r.kind === "no");
  assert.equal(r.short, 4120);
});

console.log(`\n  ${passed} checks passed`);
