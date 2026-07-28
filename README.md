# Nori

Photograph a receipt. Nori reads it with Tesseract, extracts the figures with an LLM, checks the arithmetic, and files it — you just confirm.

Self-hosted: Postgres and MinIO run in Docker on your own machine, and receipt images never leave your infrastructure.

> **Status: in development.** The extraction pipeline and auth work end to end. Object storage, the review screen, and the real dashboard are not built yet. See [Status](#status) for what is and is not done.

---

## How it works

```
image ──► sharp preprocess ──► Tesseract OCR ──► confidence routing ──┐
                                                                      │
                          ┌───────────────────────────────────────────┘
                          │
         confidence ≥ threshold ──► text extraction   (OCR text → LLM)
         confidence <  threshold ──► vision extraction (image → LLM)
                          │
                          ▼
              deterministic reconciliation ──► Postgres
                 (arithmetic, dates, currency)
```

Three ideas do most of the work:

**Every extracted field is nullable.** A model allowed to answer "I could not read that" invents far fewer values than one forced to produce a string. On smudged thermal paper an honest `null` is worth more than a plausible guess that enters a ledger unchallenged.

**Arithmetic is not the model's job.** After extraction, plain TypeScript checks that line items sum to the subtotal and that subtotal + tax + tip equals the total. This catches precisely the errors a model is most *confident* about — a cleanly misread decimal point produces a total that looks entirely reasonable in isolation and only fails against the other figures on the page. Both the US additive-tax and the UK/EU VAT-inclusive conventions are accepted, because testing only the additive form fires on essentially every British receipt.

**The pipeline never auto-confirms.** `NEEDS_REVIEW` is the normal terminal state. A human always sees the numbers once.

## Measured behaviour

Benchmarked over 183 real receipt photographs — handheld, angled, cluttered backgrounds, faded thermal paper.

| | |
| --- | --- |
| OCR confidence | mean **64.5**, median 66.0, p10 45.9, max 90.8 |
| Below the usable gate (40) | 8 / 183 (4.4%) |
| OCR time | ~913 ms mean |

Two findings worth recording:

- **Synthetic fixtures are not a substitute for real photographs.** The generated fixtures in `tests/fixtures/` score 88.0 mean; the same pipeline on real receipts scores 64.5. A 23.5-point gap.
- **A plausible preprocessing theory was wrong.** Thermal printers often use blue-violet ink, and `.greyscale()` averages the channels — so extracting the red channel *should* push blue ink darker. It won on 14 of 36 images but lost 1.9 points overall. Greyscale stayed. `scripts/preprocess-lab.mts` exists so the next such idea also gets measured rather than assumed.

## Quickstart

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env          # then fill in the blanks (see below)
npm run infra                 # postgres + minio + mailhog
npx prisma migrate dev
npm run dev                   # http://localhost:3000
```

Minimum `.env` to get running:

```bash
DATABASE_URL="postgresql://nori:nori@localhost:5432/nori"
AUTH_SECRET="..."             # openssl rand -base64 32
OPENROUTER_API_KEY="..."      # https://openrouter.ai/keys — omit to run OCR only
S3_ENDPOINT="http://localhost:9000"
S3_BUCKET="nori-receipts"
S3_ACCESS_KEY_ID="nori"
S3_SECRET_ACCESS_KEY="noripassword"
```

`lib/env.ts` validates all of this at boot and refuses to start with every problem listed at once, rather than failing on the first user upload at 2am.

Docker Compose runs the backing services only. The app runs on the host — bind mounts plus `node_modules` in a Linux container on Windows makes hot reload unusably slow.

## Working on the pipeline

The UI is far too slow a feedback loop for tuning extraction, and going through it hides the OCR text that explains most bad results.

```bash
npm run analyze <image>                  # full pipeline, pretty-printed
npm run analyze <image> -- --text        # include the raw OCR text
npm run analyze <image> -- --ocr-only    # skip the LLM entirely
npm run analyze <image> -- --vision      # force the vision path

npm run fixtures                         # regenerate synthetic fixtures
npm run ocr:bench                        # OCR confidence across fixtures

npx tsx scripts/eval.mts                 # score against hand-written ground truth
npx tsx scripts/bench-real.mts --llm 40  # run over a directory of real photos
npx tsx scripts/bench-paths.mts --n 30   # text vs vision, head to head
npx tsx scripts/preprocess-lab.mts       # A/B preprocessing variants
```

Prompts are versioned files under `lib/orchestrator/prompts/`, and the version string is written to every `ProcessingRun` row. When accuracy moves you need to know which prompt produced which result.

`bench-real.mts` and `bench-paths.mts` read from `receipts_train/`, which is **not** in this repository — it is a third-party dataset of real receipts. Point `--dir` at your own images.

## Two invariants

**Money is always an integer in the currency's minor unit**, paired with an ISO-4217 code. `£12.34` is `1234` + `"GBP"`. Never a float, never a `Decimal` above the database layer. All arithmetic goes through `lib/money.ts`, which exists as a single chokepoint precisely so this stays enforceable rather than aspirational. Float corruption in a ledger is silent and unrecoverable once rows exist.

**Every user-owned row hangs off a `Workspace`, never directly off a `User`.** There is no workspace switcher in v1, but the boundary exists in the schema and in every query, so adding teams later is additive UI work rather than a migration across every table. Queries go through `lib/db/scope.ts`, which takes the workspace from the session and never from the request — an IDOR here leaks somebody's complete financial history.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Auth.js v5 · Prisma 7 + PostgreSQL · MinIO · tesseract.js + sharp · OpenRouter (OpenAI models)

Full architecture, data model, prompts and UI design are in [`docs/SPEC.md`](docs/SPEC.md), including an as-built deviations log.

## Status

**Working, verified by running it**

- Register / sign in with email + password (Argon2id); personal workspace and 19 seeded categories created in one transaction
- Route protection, user menu, sign out
- Upload → preprocess → OCR → extract → reconcile, streamed to the browser as named stages over NDJSON
- Vision fallback when OCR confidence is low, with the chosen path surfaced in the UI
- Results persisted to Postgres, scoped by workspace, deduplicated by SHA-256 checksum
- Benchmark and evaluation harnesses

**Known issues**

- After registering, the browser stays on `/signup` instead of following the redirect to `/app`. The account *is* created and the session *is* established — navigating to `/app` manually works. Under investigation.
- The vision path is verified on individual images but has not been benchmarked at scale, so there is no aggregate accuracy figure for it yet.

**Not built yet**

- MinIO upload — images are processed in memory and discarded; only extracted text and structured data persist
- The review screen with field-to-image bounding-box highlighting
- Receipts list, real dashboard data, insights, CSV export
- Background queue (`pg-boss`); extraction currently runs inline in the request

## Licence

Not yet licensed. All rights reserved.
