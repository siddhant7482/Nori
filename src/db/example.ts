import { addDays, type Day } from "@/lib/london";

/* ============================================================
   THE EXAMPLE CYCLE: the same month as the design mock, as rows.

   Used twice: by `pnpm check`, which asserts the arithmetic against
   figures worked out by hand, and by `pnpm seed:example`, which
   loads it into a development database so every screen can be built
   and looked at before a real Monzo account is connected.

   It is never your data. The seed refuses to run against a database
   that holds a Monzo connection.
   ============================================================ */

export const EXAMPLE_TODAY: Day = "2026-09-12";
const START: Day = "2026-08-25";

export const EXAMPLE_CATEGORIES = [
  { id: "groc", name: "Groceries", hex: "#0e7a45", limit: 32000, fixed: false, position: 0, monzo: ["groceries"] },
  { id: "shop", name: "Shopping", hex: "#4a3aa7", limit: 15000, fixed: false, position: 1, monzo: ["shopping", "personal_care"] },
  { id: "eat", name: "Eating out", hex: "#e0603f", limit: 20000, fixed: false, position: 2, monzo: ["eating_out"] },
  { id: "trans", name: "Transport", hex: "#2a78d6", limit: 12000, fixed: false, position: 3, monzo: ["transport"] },
  { id: "bills", name: "Bills", hex: "#5d6d74", limit: 114000, fixed: true, position: 4, monzo: ["bills"] },
];

export interface ExampleTx {
  id: string;
  day: Day;
  amount: number;
  kind: "spend" | "refund" | "income" | "pot" | "transfer" | "ignored";
  categoryId: string | null;
  description: string;
  merchantName: string | null;
  counterpartyName: string | null;
  potId: string | null;
  monzoCategory: string | null;
}

const MONZO_CAT: Record<string, string> = { groc: "groceries", eat: "eating_out", trans: "transport", shop: "shopping", bills: "bills" };

export function exampleTransactions(): ExampleTx[] {
  const out: ExampleTx[] = [];
  let n = 0;
  const at = (d: number) => addDays(START, d - 1);
  const t = (d: number, m: string, spent: number, cat: string | null, x: Partial<ExampleTx> = {}) =>
    out.push({
      id: "tx_example_" + String(++n).padStart(4, "0"),
      day: at(d),
      amount: -spent,
      kind: "spend",
      categoryId: cat,
      description: m.toUpperCase(),
      merchantName: cat ? m : null,
      counterpartyName: null,
      potId: null,
      monzoCategory: cat ? MONZO_CAT[cat] : "general",
      ...x,
    });

  /* Six salaries, so payday can be found rather than assumed. April and
   * July fell on a Saturday; the rule moves them to the Friday. */
  const pays: [Day, number][] = [["2026-03-25", 276000], ["2026-04-24", 276000], ["2026-05-25", 312000], ["2026-06-25", 276000], ["2026-07-24", 276000], ["2026-08-25", 276000]];
  for (const [day, amount] of pays) {
    out.push({ id: "tx_example_pay_" + day, day, amount, kind: "income", categoryId: null, description: "ACME STUDIO LTD SALARY", merchantName: null, counterpartyName: "ACME Studio Ltd", potId: null, monzoCategory: "income" });
  }
  const pot = (d: number, name: string, id: string, amt: number) =>
    out.push({ id: "tx_example_pot_" + id, day: at(d), amount: -amt, kind: "pot", categoryId: null, description: "pot_" + id, merchantName: null, counterpartyName: name, potId: "pot_example_" + id, monzoCategory: "savings" });
  pot(1, "Rainy day", "rainy", 40000);
  pot(1, "Holiday", "holiday", 25000);
  pot(1, "House deposit", "house", 18000);

  t(1, "Leon", 1240, "eat"); t(1, "TfL", 290, "trans");
  t(2, "Sainsbury's Local", 3840, "groc"); t(2, "TfL", 290, "trans");
  t(3, "Wagamama", 2480, "eat"); t(3, "TfL", 290, "trans");
  t(4, "Pret A Manger", 820, "eat"); t(4, "Co-op", 620, "groc"); t(4, "TfL", 290, "trans");
  t(5, "Deliveroo", 3160, "eat");
  t(6, "Franco Manca", 4520, "eat"); t(6, "Trainline", 2790, "trans");
  t(7, "Sainsbury's", 5210, "groc"); t(7, "Costa", 380, "eat"); t(7, "Nando's", 1510, "eat"); t(7, "TfL", 290, "trans");
  t(8, "J Patel", 95000, "bills", { description: "J PATEL RENT", merchantName: null, counterpartyName: "J Patel" }); t(8, "Tesco Express", 435, "groc"); t(8, "TfL", 290, "trans");
  t(9, "Pret A Manger", 685, "eat"); t(9, "TfL", 290, "trans");
  t(10, "Leon", 1420, "eat"); t(10, "M&S Food", 1180, "groc"); t(10, "TfL", 290, "trans"); t(10, "PAYPAL *STEAM", 1249, null);
  t(11, "Deliveroo", 2250, "eat"); t(11, "TfL", 290, "trans");
  /* Splits count only your share until phase 3 models them; the example
   * books the shares so the totals match the mock. */
  t(12, "Dishoom", 2350, "eat"); t(12, "Boots", 1801, "shop"); t(12, "LB Camden", 14200, "bills", { description: "LB CAMDEN COUNCIL TAX", merchantName: null, counterpartyName: "LB Camden" });
  t(13, "Lidl", 4490, "groc"); t(13, "SUMUP *MARKET STALL", 600, null);
  t(14, "Pret A Manger", 685, "eat"); t(14, "Leon", 1395, "eat"); t(14, "TfL", 290, "trans");
  t(15, "Amazon", 4299, "shop"); t(15, "Co-op", 760, "groc"); t(15, "TfL", 290, "trans");
  t(16, "Uber", 840, "trans"); t(16, "Lime", 840, "trans"); t(16, "Tesco", 2611, "groc"); t(16, "TfL", 290, "trans"); t(16, "SQ *LEVAIN BAKERY", 820, null);
  t(17, "Deliveroo", 3160, "eat"); t(17, "TfL", 290, "trans");
  t(18, "Tesco Express", 2314, "groc"); t(18, "TfL", 290, "trans");
  t(19, "Pret A Manger", 685, "eat"); t(19, "TfL", 290, "trans");

  /* Earlier cycles, as a handful of payments each, so the history
   * charts have something true to draw. Totals match the mock. */
  const HIST: Record<string, number[]> = {
    groc: [29800, 31100, 28700, 34200, 30500],
    eat: [17600, 20400, 15800, 24100, 22900],
    trans: [10400, 9800, 12100, 8800, 11200],
    shop: [14200, 8800, 21500, 9700, 13100],
    bills: [113100, 113100, 113800, 114000, 114200],
  };
  const NAMES: Record<string, string[]> = { groc: ["Sainsbury's", "Tesco", "Lidl"], eat: ["Leon", "Deliveroo", "Pret A Manger"], trans: ["TfL", "Trainline"], shop: ["Amazon", "Boots"], bills: ["J Patel"] };
  for (let i = 0; i < 5; i++) {
    const from = pays[i][0];
    for (const [cat, totals] of Object.entries(HIST)) {
      const parts = cat === "bills" ? 1 : 5;
      const each = Math.floor(totals[i] / parts);
      for (let k = 0; k < parts; k++) {
        const amount = k === parts - 1 ? totals[i] - each * (parts - 1) : each;
        const name = NAMES[cat][k % NAMES[cat].length];
        out.push({ id: `tx_example_h${i}_${cat}_${k}`, day: addDays(from, 2 + k * 5), amount: -amount, kind: "spend", categoryId: cat, description: name.toUpperCase(), merchantName: cat === "bills" ? null : name, counterpartyName: cat === "bills" ? name : null, potId: null, monzoCategory: MONZO_CAT[cat] });
      }
    }
  }
  return out;
}
