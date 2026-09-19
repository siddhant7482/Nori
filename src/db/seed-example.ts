import "@/env";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, connection, pots, settings, transactions } from "@/db/schema";
import { EXAMPLE_CATEGORIES, EXAMPLE_TODAY, exampleTransactions } from "./example";

/* ============================================================
   `pnpm seed:example`: the design mock's month, as rows, so every
   screen can be built and checked before Monzo is connected.

   Refuses outright when the database holds a Monzo connection. The
   example rows are marked (ids start tx_example_, raw.example) and
   `--wipe` removes exactly those and nothing else.
   ============================================================ */

async function main() {
  const [conn] = await db.select({ id: connection.id }).from(connection);
  if (conn) {
    console.error("seed:example refused: this database holds a real Monzo connection.");
    process.exit(1);
  }

  if (process.argv.includes("--wipe")) {
    const r = await db.delete(transactions).where(sql`${transactions.id} like 'tx_example_%'`).returning({ id: transactions.id });
    await db.delete(pots).where(sql`${pots.id} like 'pot_example_%'`);
    await db.delete(accounts).where(sql`${accounts.id} = 'acc_example'`);
    console.log(`seed:example: removed ${r.length} example transactions`);
    process.exit(0);
  }

  for (const c of EXAMPLE_CATEGORIES) {
    await db.insert(categories).values(c).onConflictDoUpdate({ target: categories.id, set: c });
  }
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  await db
    .insert(accounts)
    .values({ id: "acc_example", type: "uk_retail", description: "Example current account", createdAt: new Date("2021-03-01T09:00:00Z"), balance: 184_233, balanceAt: new Date() })
    .onConflictDoNothing();
  const potRows = [
    { id: "pot_example_rainy", name: "Rainy day", balance: 360000, goal: 342000 },
    { id: "pot_example_holiday", name: "Holiday", balance: 124000, goal: 180000 },
    { id: "pot_example_house", name: "House deposit", balance: 618000, goal: 2000000 },
  ];
  for (const p of potRows) await db.insert(pots).values({ ...p, accountId: "acc_example", deleted: false, updatedAt: new Date() }).onConflictDoNothing();

  const rows = exampleTransactions().map((t) => ({
    id: t.id,
    accountId: "acc_example",
    created: new Date(t.day + "T12:00:00Z"),
    settled: new Date(t.day + "T12:00:00Z"),
    day: t.day,
    amount: t.amount,
    currency: "GBP",
    description: t.description,
    merchantName: t.merchantName,
    merchantGroupId: t.merchantName ? "grp_example_" + t.merchantName.toLowerCase().replace(/[^a-z]+/g, "") : null,
    counterpartyName: t.counterpartyName,
    monzoCategory: t.monzoCategory,
    kind: t.kind,
    potId: t.potId,
    categoryId: t.categoryId,
    filedBy: t.categoryId ? ("monzo" as const) : null,
    raw: { example: true },
  }));
  await db.insert(transactions).values(rows).onConflictDoNothing();
  console.log(`seed:example: ${rows.length} example transactions. Set NORI_TODAY=${EXAMPLE_TODAY} to see the cycle as designed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
