# Nori

Money for CommandHQ. Nori reads a Monzo account, works out when payday is, and turns
what's left in your budgets into one number: **what you can spend each day until payday.**

Nothing is typed in. Manual entry dies in week two, so the bank is the referee: Monzo's
feed is the complete record, and Nori's job is arithmetic on it.

## The ideas it's built on

**Payday cycles, not calendar months.** The salary is found in the feed (the largest credit
from the same payer about once a month) and its dates are explained by a rule: the Nth, or
the Friday before when that's a weekend, or the last working day. Budgets run salary to
salary, because that's how long the money has to last.

**The daily number.** What's left in the budgets you spend from, divided by the days still
to get through, today included.

**An overspend borrows, visibly.** A budget that goes over takes the shortfall from the one
with the most room. The lender really does have less, and nothing is hidden. Both reset on
payday.

**Money moving is not money going.** Salary, pot moves and transfers between your own
accounts never count as spending.

**Read-only, structurally.** Monzo's API can move money between pots. Nori's client only
has read calls in it (`src/monzo/client.ts`); the only other request it makes is its own
login.

**No texts, no email, no nudges.** The pressure is in Nori and on the CommandHQ hub, in one
of three voices: clean, direct, or warden.

## Running it

```bash
pnpm install
cp .env.example .env.local     # database, Monzo client, encryption key
pnpm db:push
pnpm seed:example              # optional: the design's example month, for building UI
pnpm dev                       # http://localhost:3006
```

With `NORI_TODAY="2026-09-12"` in `.env.local`, the example cycle reads exactly like the
design: day 19 of 31, eating out over and borrowing from groceries. The seed refuses to run
against a database with a real Monzo connection, and `pnpm seed:example --wipe` removes only
its own rows.

| | |
| --- | --- |
| `pnpm check` | the arithmetic (payday, cycles, IOUs, the daily number, afford) against figures worked out by hand |
| `pnpm sync` | what the five-minute timer runs; exits 0 when Monzo isn't connected yet |
| `pnpm sync --full` | walk the whole history again (only useful inside Monzo's five-minute window) |

## Connecting Monzo

1. At developers.monzo.com, create an OAuth client. Make it **confidential**: only
   confidential clients get refresh tokens.
2. Register the redirect URL `http://nori.hq.<domain>/api/monzo/callback`.
3. Put the ID, secret and a `TOKEN_ENCRYPTION_KEY` in `.env.local`, restart, and press
   **Connect Monzo** in Settings.
4. Approve Nori in the Monzo app. Settings is watching, and the first sync starts the moment
   you do.

Monzo only serves history older than 90 days for about five minutes after you authenticate,
so the first sync races that clock. If the window closes part way, Nori keeps what it got,
takes the last 90 days, and says so in Settings.

## On the node

Nori runs in its own container on the CommandHQ node, like every app there, against its own
database on the shared Postgres. `deploy/provision-nori.sh` is idempotent: it pulls
`origin/main`, builds, pushes the schema, and installs the web service plus the five-minute
sync timer. `GET /api/status` is what the hub polls.

## The receipt engine

The hackathon receipt scanner is kept in `receipts/`, parked until receipts are matched onto
bank transactions. See [`receipts/README.md`](receipts/README.md).

## Stack

Next.js 16 · React 19 · TypeScript · Drizzle + Postgres · the Monzo API
