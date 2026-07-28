# Nori — Receipt & Expenditure Tracker

**Master specification.** This is the source of truth for scope, architecture, data model, the OCR → LLM pipeline, and UI design. Every build task should trace back to a section here.

Status: `DRAFT v1` · Owner: siddh · Last updated: 2026-07-28

---

## 1. Product

Nori turns a photo of a paper receipt into a structured, categorized expense record without manual data entry.

**The core loop:** point camera at receipt → upload → Nori reads it → user glances at the extracted fields and confirms → it lands in the ledger, categorized.

The entire product hinges on one thing: **the review step must be faster than typing it in manually.** If a user has to correct three fields per receipt, we have failed. Everything in §6 and §8 is in service of that.

### 1.1 v1 scope

| In | Out (deferred) |
| --- | --- |
| Email + Google sign-in | Teams UI, invites, roles |
| Upload receipt (camera or file) | Bank / card feed sync |
| OCR + structured extraction | Mileage, per-diem, reimbursements |
| Auto-categorization | Approval workflows |
| Review & correct screen | Multi-currency conversion |
| Receipt list, search, filters | Mobile native app |
| Dashboard + LLM period summary | Recurring-subscription detection |
| CSV / JSON export | Budgets & alerts |

### 1.2 Scope decision: personal now, teams-ready

Every user-owned row hangs off a `Workspace`, not directly off a `User`. On signup we auto-create a personal workspace (`personal: true`) with the user as `OWNER`. v1 never shows a workspace switcher — but the boundary exists in the schema and in every query, so adding teams later is additive UI work rather than a data migration across every table.

**Non-negotiable rule:** no query ever filters by `userId` alone. Always `workspaceId`, resolved from the session. See §5.4.

---

## 2. Stack

> **As-built, 2026-07-28:** Next 16.2.12 / React 19.2.4 / Prisma 7.9.1 / Zod 4.4.3 / Tailwind 4. Deviations from the plan below are recorded in §14.

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict | Server Components for data-heavy list/dashboard views; Route Handlers give the worker a home |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix primitives) | Own the component code, no theme fights, accessible by default |
| Auth | Auth.js (NextAuth v5) + Prisma adapter | Requested. Database sessions, not JWT — see §4 |
| DB | PostgreSQL 16 + Prisma | Requested |
| Blob storage | MinIO (S3 API) via `@aws-sdk/client-s3` | Requested. Self-hosted, presigned URLs, swaps to R2/S3 by env change alone |
| OCR | `tesseract.js` in a Node worker + `sharp` preprocessing | Requested. Server-side for consistency (§6.2) |
| Queue | `pg-boss` | Job state lives in the same Postgres transaction as the `Receipt` row — no split-brain between "receipt exists" and "job exists", and no Redis container. Swap to BullMQ if you later need high concurrency or a dashboard |
| LLM | **OpenRouter** via the OpenAI SDK, Structured Outputs (`json_schema`, `strict: true`) | Requested. OpenRouter speaks the OpenAI wire protocol, so the model is a single env var and can be swapped without touching client code |
| Validation | Zod (shared between API, forms, and LLM schema) | One schema definition, three consumers |
| Charts | Recharts | Enough for the dashboard; no d3 hand-rolling |
| Tests | Vitest (unit), Playwright (E2E) | |
| Local infra | Docker Compose: `postgres`, `minio`, `app`, `worker` | |

**Runtime constraint:** `tesseract.js` and `sharp` are native/WASM and cannot run on the Edge runtime. The worker is a plain long-running Node process (`worker/index.ts`), **not** a serverless function. This is why the Compose file has a separate `worker` service.

---

## 3. Architecture

```
┌──────────────┐
│   Browser    │
│  (Next.js)   │
└──────┬───────┘
       │ 1. POST /api/uploads/presign  → { url, objectKey }
       │ 2. PUT  <presigned url>       ──────────────────────────┐
       │ 3. POST /api/receipts { objectKey }                     │
       │ 4. GET  /api/receipts/:id/stream  (SSE status updates)  │
       ▼                                                         ▼
┌──────────────────────────┐                            ┌──────────────┐
│  Next.js Route Handlers  │                            │    MinIO     │
│  auth · CRUD · presign   │                            │  receipts/   │
└────────┬─────────────────┘                            └──────┬───────┘
         │ enqueue(job)                                        │
         ▼                                                     │ download
┌──────────────────────────┐                                   │
│  Postgres (+ pg-boss)    │◄──────────────────────┐           │
└──────────────────────────┘                       │           │
                                                   │           │
                          ┌────────────────────────┴───────────▼──────┐
                          │            Worker (Node)                  │
                          │                                           │
                          │  ① sharp    preprocess → normalized png   │
                          │  ② tesseract OCR      → text + bboxes     │
                          │  ③ orchestrator       → OpenAI            │
                          │       ├ extract   (strict json_schema)    │
                          │       ├ categorize                        │
                          │       └ reconcile / validate              │
                          │  ④ persist Expense + LineItems            │
                          └───────────────────────────────────────────┘
```

**Why the image never passes through the API server:** presigned PUT means a 4 MB phone photo goes browser → MinIO directly. The API handles only small JSON. This keeps request timeouts and memory flat regardless of image size.

### 3.1 Receipt state machine

```
UPLOADED ──► QUEUED ──► PREPROCESSING ──► OCR_RUNNING ──► EXTRACTING ──► NEEDS_REVIEW ──► CONFIRMED
                │             │                │               │              ▲
                └─────────────┴────────────────┴───────────────┴──► FAILED ───┘
                                                                    (retryable)
```

- `NEEDS_REVIEW` is the normal terminal state of automated processing. **The pipeline never auto-confirms.** A human always sees the numbers once.
- `FAILED` records `errorCode` + `errorMessage` and stays retryable from the UI. A failure must never lose the uploaded image.
- Every transition writes a `ProcessingRun` row (§5.3) — that table is how you debug and cost-account the pipeline.

---

## 4. Authentication

Auth.js v5, Prisma adapter, **database session strategy** (not JWT).

Rationale: an expense ledger needs immediate revocation — sign out everywhere, kick a removed team member — and database sessions give that for free. JWT sessions would keep working until expiry, which is the wrong default when the sessions guard financial records.

**Providers**
1. **Google OAuth** — primary, zero-friction.
2. **Email magic link** (Nodemailer → Mailhog locally) — no password to store, no reset flow to build. Prefer this over credentials.

If a password provider is genuinely required later, use `@node-rs/argon2`, never bcrypt-with-low-rounds, and rate-limit by IP + email.

**Session shape** — augment via module declaration in `types/next-auth.d.ts`:

```ts
session.user = { id, name, email, image }
session.workspaceId   // active workspace, resolved server-side
session.role          // OWNER | ADMIN | MEMBER
```

**On first sign-in** (`events.createUser`): create the personal `Workspace`, the `OWNER` `Membership`, and seed the default `Category` set (§5.2) in a single transaction.

**Protection:** `middleware.ts` guards `/app/*` and redirects unauthenticated users to `/signin?callbackUrl=…`. Route handlers re-check the session independently — middleware is UX, not a security boundary.

---

## 5. Data model

Prisma. `snake_case` in the DB via `@@map`, `camelCase` in TS.

### 5.1 Money rule — read this before writing any schema

**All monetary amounts are `Int`, in the currency's minor unit (cents/pence), never `Float`, never `Decimal` in app code.** Each row carries an ISO-4217 `currency` string. `12.34 USD` is stored as `1234` + `"USD"`.

Floats silently corrupt sums. This is the single highest-cost mistake available in this project, and it is unrecoverable once data exists. Format at the render boundary only, with `Intl.NumberFormat`.

### 5.2 Entities

```prisma
// ─── Auth (Auth.js required shape) ──────────────────────────
model User    { id String @id @default(cuid()) email String @unique name String? image String?
                accounts Account[] sessions Session[] memberships Membership[]
                createdAt DateTime @default(now()) }
model Account { /* Auth.js standard */ }
model Session { /* Auth.js standard */ }
model VerificationToken { /* Auth.js standard */ }

// ─── Tenancy ────────────────────────────────────────────────
model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  personal  Boolean  @default(true)
  currency  String   @default("GBP")   // default for new receipts
  members   Membership[]
  receipts  Receipt[]
  categories Category[]
  merchants Merchant[]
  createdAt DateTime @default(now())
}

model Membership {
  id          String @id @default(cuid())
  userId      String
  workspaceId String
  role        Role   @default(OWNER)
  @@unique([userId, workspaceId])
}
enum Role { OWNER ADMIN MEMBER }

// ─── Receipts & extraction ──────────────────────────────────
model Receipt {
  id            String        @id @default(cuid())
  workspaceId   String
  uploadedById  String
  status        ReceiptStatus @default(UPLOADED)

  objectKey     String        // MinIO key: ws/<wsId>/<yyyy>/<mm>/<ulid>.jpg
  mimeType      String
  byteSize      Int
  checksumSha256 String       // dedupe: same file twice → link, don't reprocess

  ocrText       String?       @db.Text
  ocrWords      Json?         // [{ text, conf, bbox:[x0,y0,x1,y1] }] — powers §8.5 highlighting
  ocrConfidence Float?        // mean word confidence 0-100
  ocrEngine     String?       // "tesseract.js@5.x/eng"

  errorCode     String?
  errorMessage  String?
  processedAt   DateTime?

  expense       Expense?
  runs          ProcessingRun[]
  createdAt     DateTime      @default(now())

  @@unique([workspaceId, checksumSha256])
  @@index([workspaceId, status, createdAt])
}

enum ReceiptStatus { UPLOADED QUEUED PREPROCESSING OCR_RUNNING EXTRACTING NEEDS_REVIEW CONFIRMED FAILED }

model Expense {
  id            String   @id @default(cuid())
  workspaceId   String
  receiptId     String   @unique
  merchantId    String?
  categoryId    String?

  purchasedAt   DateTime
  currency      String
  subtotal      Int?     // minor units — see §5.1
  taxTotal      Int?
  tipTotal      Int?
  total         Int
  paymentMethod String?  // CARD | CASH | OTHER
  cardLast4     String?

  notes         String?
  confidence    Float    // 0-1, model's own field-level mean
  needsReview   Boolean  @default(true)
  reviewedAt    DateTime?
  reviewedById  String?
  editedFields  String[] // which fields a human overrode → training signal for §7.5

  lineItems     LineItem[]

  @@index([workspaceId, purchasedAt])
  @@index([workspaceId, categoryId])
}

model LineItem {
  id          String  @id @default(cuid())
  expenseId   String
  lineNumber  Int
  description String
  quantity    Decimal @default(1) @db.Decimal(10,3)  // 0.85 kg is legitimate
  unitPrice   Int?
  total       Int
  categoryId  String?
}

model Merchant {
  id             String @id @default(cuid())
  workspaceId    String
  name           String            // as printed
  normalizedName String            // lowercased, punctuation stripped — the match key
  defaultCategoryId String?        // learned: "this shop is always Groceries"
  @@unique([workspaceId, normalizedName])
}

model Category {
  id          String  @id @default(cuid())
  workspaceId String?           // null = system default, cloned on workspace create
  parentId    String?
  name        String
  icon        String            // lucide icon name
  color       String            // token name from §8.2, not a hex literal
  isSystem    Boolean @default(false)
}

// ─── Observability ──────────────────────────────────────────
model ProcessingRun {
  id            String   @id @default(cuid())
  receiptId     String
  stage         String   // preprocess | ocr | extract | categorize
  status        String   // ok | error
  model         String?  // e.g. "gpt-4.1-mini"
  promptVersion String?  // "extract@v3" — pin every call, §7.4
  inputTokens   Int?
  outputTokens  Int?
  costMicros    Int?     // millionths of a currency unit
  latencyMs     Int
  rawResponse   Json?
  error         String?
  createdAt     DateTime @default(now())
  @@index([receiptId, createdAt])
}
```

**Seed categories:** Groceries · Restaurants & Cafés · Transport · Fuel · Travel & Accommodation · Utilities · Rent & Mortgage · Health & Pharmacy · Personal Care · Clothing · Electronics · Home & Garden · Entertainment · Subscriptions · Education · Office & Software · Gifts & Donations · Fees & Charges · Other.

Keep this list stable — it is injected verbatim into the categorization prompt (§7.3), so changes there change model behaviour.

### 5.3 Indexing notes

The dashboard's hot query is "sum by category for a date range in one workspace." `@@index([workspaceId, purchasedAt])` plus `@@index([workspaceId, categoryId])` covers it. Add a covering index only after `EXPLAIN ANALYZE` on real data says you need one.

### 5.4 Tenant isolation

Wrap every read in a helper that takes the workspace from the session, never from the request body:

```ts
// lib/db/scope.ts
export async function scoped<T>(fn: (ws: string, tx: PrismaClient) => Promise<T>) {
  const session = await auth();
  if (!session?.workspaceId) throw new UnauthorizedError();
  return fn(session.workspaceId, prisma);
}
```

An IDOR here leaks someone's financial history. A client-supplied `workspaceId` must always be validated against the session's memberships before use — treat any code path that skips this as a release blocker.

---

## 6. OCR pipeline

### 6.1 Preprocessing (`sharp`) — do not skip this

Tesseract's accuracy on a raw phone photo is poor; on a preprocessed one it is usable. This step is worth more accuracy than any prompt tuning downstream.

```ts
sharp(buffer)
  .rotate()                              // honour EXIF orientation
  .greyscale()
  .resize({ width: 2000, withoutEnlargement: true })  // ~300 DPI equivalent
  .normalise()                           // stretch contrast
  .sharpen()
  .png()                                 // lossless into Tesseract
```

Deskew is the notable gap — `sharp` has no built-in. If tilted receipts prove to be a real failure mode, add a Hough-transform angle estimate before `.rotate(angle)`. Measure first; don't build it speculatively.

### 6.2 Recognition

```ts
const worker = await createWorker('eng');       // reuse across jobs — init is ~2s
await worker.setParameters({
  tessedit_pageseg_mode: PSM.SINGLE_BLOCK,      // receipts are one tall column
  preserve_interword_spaces: '1',
});
const { data } = await worker.recognize(png);
// data.text, data.confidence, data.words[].bbox
```

**Persist `data.words` with bounding boxes.** They cost nothing to store and they unlock the review UI's field-to-image highlighting (§8.5) — the single feature that makes the review step feel trustworthy.

**Pool the worker.** Creating a Tesseract worker per job dominates latency. Initialize a small pool (2–4, matched to CPU cores) at process start and hold it for the process lifetime. Language traineddata is baked into the Docker image, not fetched at runtime.

### 6.3 Quality gate

If `ocrConfidence < 40` or `ocrText.length < 20`, skip the LLM call entirely — mark `FAILED` with `errorCode: LOW_OCR_QUALITY` and prompt the user to retake the photo. Sending garbage to the model produces confident-looking fabricated numbers, which is far worse than an honest failure.

---

## 7. OpenAI orchestrator

Lives in `lib/orchestrator/`. Pure functions over text — no DB access, no S3 access. This makes every stage independently testable against fixture files.

```
lib/orchestrator/
  client.ts        OpenAI client, retry/backoff, cost accounting
  schemas.ts       Zod schemas → JSON Schema (single source of truth)
  extract.ts       ocrText → structured receipt
  categorize.ts    merchant + line items → category
  summarize.ts     expense set → narrative insights
  reconcile.ts     deterministic arithmetic checks (no LLM)
  prompts/         versioned prompt text
```

### 7.1 Model & call settings

- **Extraction / categorization:** a small structured-output-capable model (`gpt-4.1-mini` class). Confirm current model IDs at build time rather than trusting this doc.
- **Summaries:** same tier; upgrade only if narrative quality is visibly weak.
- `temperature: 0` — extraction is not a creative task.
- **Structured Outputs** with `strict: true`. Do not parse free-form JSON out of prose; the whole class of "model returned markdown fences" bugs disappears with strict schemas.
- Timeout 30s, 2 retries with exponential backoff, jittered.
- Hard cap input at ~8k tokens; truncate `ocrText` from the middle if a pathological OCR result blows past it.

### 7.2 Extraction schema (Zod → JSON Schema)

```ts
export const ExtractedReceipt = z.object({
  merchantName:   z.string().nullable(),
  merchantAddress: z.string().nullable(),
  purchasedAt:    z.string().nullable(),      // ISO 8601; null if unreadable
  currency:       z.string().length(3).nullable(),
  subtotal:       z.number().int().nullable(), // MINOR UNITS
  taxTotal:       z.number().int().nullable(),
  tipTotal:       z.number().int().nullable(),
  total:          z.number().int().nullable(),
  paymentMethod:  z.enum(['CARD','CASH','OTHER']).nullable(),
  cardLast4:      z.string().regex(/^\d{4}$/).nullable(),
  lineItems: z.array(z.object({
    description: z.string(),
    quantity:    z.number().default(1),
    unitPrice:   z.number().int().nullable(),
    total:       z.number().int(),
  })),
  fieldConfidence: z.object({
    merchantName: z.number().min(0).max(1),
    purchasedAt:  z.number().min(0).max(1),
    total:        z.number().min(0).max(1),
    lineItems:    z.number().min(0).max(1),
  }),
});
```

Every field is `.nullable()` by design. **A model that can return `null` returns fewer invented values than one forced to produce a string.** Nullability is the primary hallucination defence here.

### 7.3 Prompts

`prompts/extract@v1.md`:

> You extract structured data from OCR text of a retail receipt. The OCR is imperfect: characters may be wrong, lines may be merged or split, and columns may be misaligned.
>
> Rules:
> 1. Extract only what is present in the text. If a value is absent, ambiguous, or unreadable, return `null`. Never infer, estimate, or invent a value.
> 2. All monetary amounts are integers in the currency's **minor unit**. `£12.34` → `1234`. `$0.99` → `99`.
> 3. `purchasedAt` is full ISO 8601. Resolve ambiguous formats using the merchant's country when it is determinable from the address; otherwise prefer DD/MM/YYYY and lower the confidence for that field.
> 4. `total` is the final amount actually paid, after discounts and including tax and tip.
> 5. Line items are only individually priced goods or services. Exclude subtotal, tax, tip, discount, change, loyalty-point, and balance lines.
> 6. OCR frequently confuses `O`/`0`, `l`/`1`/`I`, `S`/`5`, `B`/`8`. Correct these when context makes the intent unambiguous — for example inside a price.
> 7. `fieldConfidence` reflects your genuine certainty. A low score is useful; an overconfident score is harmful, because it decides whether a human checks your work.

`prompts/categorize@v1.md`:

> Assign exactly one category from the provided list to this expense, using the merchant name and the line items. Prefer the merchant's evident primary business over individual items — a bottle of water bought at a petrol station is `Fuel`, not `Groceries`. Use `Other` when no category fits with reasonable confidence rather than forcing a poor match.

Prompts are files, loaded at boot, versioned in the filename, and the version string is written to `ProcessingRun.promptVersion`. When accuracy shifts you need to know which prompt produced which result.

### 7.4 Deterministic reconciliation (`reconcile.ts`, no LLM)

Arithmetic is not the model's job. After extraction, in plain TypeScript:

1. `sum(lineItems.total)` vs `subtotal` — within 2 minor units → OK.
2. `subtotal + taxTotal + tipTotal` vs `total` — within 2 minor units → OK.
3. `purchasedAt` not in the future, not before 2000.
4. `total > 0`.

Any failure sets `needsReview = true` and attaches a specific warning shown in the review UI ("line items sum to £42.10 but subtotal reads £42.90"). **This catches the errors the model is most confident about**, which is exactly the set a human reviewer would otherwise skim past.

### 7.5 Learning from corrections

When a user edits a field, record it in `Expense.editedFields`. Two cheap wins with no ML:

- Merchant→category corrections update `Merchant.defaultCategoryId`. Next receipt from that merchant skips the categorization call entirely — faster, cheaper, and correct by construction.
- Aggregate `editedFields` counts per prompt version give a real accuracy metric to compare prompt changes against.

### 7.6 Cost control

At small-model pricing a receipt costs a fraction of a cent, but the guardrails matter more than the amount:

- Write `costMicros` on every `ProcessingRun`; surface a monthly total in admin settings.
- Per-workspace daily receipt cap (default 200), enforced before enqueue.
- Dedupe by `checksumSha256` — re-uploading the same image never triggers a second pipeline run.
- Skip categorization when `Merchant.defaultCategoryId` is set.

### 7.7 Privacy

Receipts are personal financial data. State this plainly in the privacy policy: OCR text is sent to OpenAI for structured extraction; images are not. Set OpenAI's zero-retention / no-training options where the account supports them, and make the LLM step disableable per workspace (falling back to regex-based extraction of just `total` and `date`) so the app remains functional for privacy-sensitive users.

---

## 8. UI design

### 8.1 Design principles

1. **Mobile-first capture, desktop-first review.** Capture happens standing in a shop; review happens sitting down. Design each for its context rather than compromising on one responsive middle.
2. **Numbers are the interface.** Tabular figures, right-aligned, consistent decimals. Money never reflows or jitters between states.
3. **Surface uncertainty, don't hide it.** A low-confidence field looks different from a high-confidence one. Hiding doubt to look polished is how bad data enters a ledger.
4. **Calm, not gamified.** No streaks, no confetti. This is a tool for a slightly tedious task; respect that.

### 8.2 Design tokens

Nori's palette is a deep sea-green against warm neutrals — distinct from the blue-grey default of every finance dashboard.

```css
/* Light */
--bg:            oklch(0.99 0.004 100);   /* warm off-white  */
--surface:       oklch(1    0     0);
--surface-sunken:oklch(0.97 0.005 100);
--border:        oklch(0.91 0.006 100);
--text:          oklch(0.22 0.01  150);
--text-muted:    oklch(0.52 0.012 150);
--accent:        oklch(0.52 0.11  165);   /* nori green      */
--accent-fg:     oklch(0.99 0.004 100);
--accent-subtle: oklch(0.95 0.03  165);

/* Dark */
--bg:            oklch(0.17 0.008 160);
--surface:       oklch(0.21 0.01  160);
--surface-sunken:oklch(0.15 0.008 160);
--border:        oklch(0.29 0.012 160);
--text:          oklch(0.95 0.005 100);
--text-muted:    oklch(0.68 0.01  150);
--accent:        oklch(0.72 0.13  165);
--accent-fg:     oklch(0.17 0.008 160);

/* Semantic — identical in both, tuned for contrast */
--positive: oklch(0.58 0.13 155);   /* income, confirmed   */
--warning:  oklch(0.72 0.14  75);   /* needs review        */
--danger:   oklch(0.58 0.19  25);   /* failed, delete      */
```

**Category colors** are a separate 12-hue qualitative ramp, defined once in `lib/categories/colors.ts` and referenced by token name. Never hardcode a hex in a component.

**Confidence is encoded by more than hue** — high: plain text; medium: dotted underline + amber dot; low: amber-tinted field background + warning icon. Color alone would fail for colorblind users, and this signal is too important to lose.

**Type:** Inter (UI) + `font-variant-numeric: tabular-nums` everywhere money appears. Scale: 12 / 14 / 16 / 20 / 24 / 32 / 40. **Radius:** 6px controls, 10px cards, 999px pills. **Spacing:** 4px base. **Shadows:** two only (`sm` for cards, `md` for popovers).

### 8.3 Navigation

- **Desktop (≥1024px):** fixed 240px left sidebar — Dashboard · Receipts · Insights · Categories · Settings. Prominent "Add receipt" button at the top. Workspace switcher slot exists in the layout but renders nothing in v1.
- **Mobile:** bottom tab bar of 4 — Home · Receipts · **[+ capture]** (center, raised, accent-filled) · Insights. Settings lives under the avatar.

The capture button is the visual center of the mobile app because capture is the app's only frequent action.

### 8.4 Screens

| Route | Purpose | Notes |
| --- | --- | --- |
| `/signin` | Auth | Centered card, Google button primary, email magic-link secondary, product screenshot at ≥1024px |
| `/app` | Dashboard | Month total (largest element on screen), delta vs last month, category donut, 30-day spend line, `NEEDS_REVIEW` queue card, recent 5 receipts |
| `/app/capture` | Upload | Mobile: full-bleed camera with frame guide. Desktop: large drag-drop target. Multi-file supported; each file gets its own progress row |
| `/app/receipts` | List | Data table: thumbnail, merchant, date, category pill, total, status. Filters: date range, category, status, amount range, text search. Bulk categorize/export/delete |
| `/app/receipts/[id]` | **Review** | The critical screen — §8.5 |
| `/app/insights` | Analysis | Category breakdown over time, top merchants, month-over-month, LLM narrative summary (§7), CSV/JSON export |
| `/app/categories` | Manage | Reorder, rename, recolor, merge; per-merchant default overrides |
| `/app/settings` | Config | Profile, currency, sessions, LLM toggle, usage/cost, data export, account deletion |

### 8.5 The review screen (the one that matters)

Two-pane on desktop, stacked on mobile.

```
┌────────────────────────────┬──────────────────────────────────┐
│                            │  ⚠ Check the highlighted fields  │
│    [receipt image]         │                                  │
│                            │  Merchant   [Tesco Express    ]  │
│    ┌──────────┐            │  Date       [2026-07-24       ]  │
│    │ TOTAL    │ ← bbox     │  Category   [🛒 Groceries   ▾ ]  │
│    │  £42.90  │   highlight│                                  │
│    └──────────┘            │  Subtotal   [        £40.86   ]  │
│                            │  Tax        [         £2.04   ]  │
│  [ zoom ] [ rotate ]       │  Total      [        £42.90   ]  │
│                            │  ⚠ items sum to £42.10           │
│                            │                                  │
│                            │  ▸ Line items (7)                │
│                            │                                  │
│                            │  [ Confirm ]        [ Delete ]   │
└────────────────────────────┴──────────────────────────────────┘
```

**Interactions that carry the design:**

- **Focus a field → its bounding box highlights on the image** (from `Receipt.ocrWords`). Hovering the image the other way round highlights the matching field. This is what converts "I hope the robot read it right" into "I can see where that number came from" — it is the feature that earns the user's trust in the automation, and it should be built in the first review-screen pass, not deferred as polish.
- Low-confidence fields are pre-focused and visually flagged; tab order visits them first.
- Reconciliation warnings (§7.4) appear inline next to the offending field, phrased concretely with both numbers.
- `⌘/Ctrl + Enter` confirms. High-volume users will confirm dozens in a sitting — make the keyboard path complete.
- **Optimistic confirm:** the row leaves the review queue immediately, with an undo toast. Never block on the round-trip.

### 8.6 States

Every list and card needs four states designed, not just the happy one:

- **Loading:** skeletons matching final layout dimensions. No spinners in content areas — layout shift on load reads as jank.
- **Empty:** illustration + one-sentence explanation + the primary action. The zero-receipts dashboard is the first thing a new user sees; it deserves real design attention.
- **Processing:** receipt card shows a live stage label ("Reading text…", "Understanding items…") via SSE. Vague progress bars feel slower than named stages that advance.
- **Error:** plain-language cause, a retry button, and the image preserved and visible.

### 8.7 Accessibility

WCAG 2.2 AA as the floor. All tokens above meet 4.5:1 for body text. Full keyboard reachability including the capture flow; visible focus rings (never `outline: none` without a replacement); `aria-live` on processing status; `prefers-reduced-motion` respected; every icon-only button labelled. Test the review screen with a screen reader specifically — it is the most complex interaction and the easiest to get wrong.

---

## 9. API surface

```
POST   /api/uploads/presign        → { uploadUrl, objectKey, expiresAt }
POST   /api/receipts               { objectKey, mimeType, byteSize, checksum } → Receipt
GET    /api/receipts               ?status&from&to&categoryId&q&cursor  → paginated
GET    /api/receipts/:id
GET    /api/receipts/:id/stream    SSE: { status, stage, progress }
POST   /api/receipts/:id/retry
DELETE /api/receipts/:id
PATCH  /api/expenses/:id           partial update; records editedFields
POST   /api/expenses/:id/confirm
GET    /api/categories  · POST · PATCH /:id · DELETE /:id
GET    /api/insights/summary       ?from&to  → aggregates + LLM narrative (cached 1h)
GET    /api/export                 ?format=csv|json&from&to
```

**Conventions:** cursor pagination (never `OFFSET` — it degrades and skips rows under concurrent inserts); Zod-validated bodies; RFC 7807 problem+json errors; rate limits on `presign` (30/min) and `insights/summary` (10/hour, it costs money).

---

## 10. Project structure

```
nori/
├─ app/
│  ├─ (marketing)/page.tsx
│  ├─ (auth)/signin/page.tsx
│  ├─ (app)/app/…                    dashboard, capture, receipts, insights, settings
│  └─ api/…
├─ components/ui/                    shadcn primitives
├─ components/receipts/              ReceiptCard, ReviewPane, ImageViewer, ConfidenceField
├─ components/charts/
├─ lib/
│  ├─ auth.ts        db/scope.ts     prisma.ts
│  ├─ storage/minio.ts
│  ├─ ocr/{preprocess,tesseract,pool}.ts
│  ├─ orchestrator/…                 §7
│  ├─ money.ts                       parse / format / arithmetic — ALL money goes through here
│  └─ validation/
├─ worker/
│  ├─ index.ts                       pg-boss subscriber
│  └─ jobs/process-receipt.ts
├─ prisma/{schema.prisma,seed.ts}
├─ tests/{unit,e2e,fixtures/receipts/}
├─ docs/SPEC.md
├─ docker-compose.yml
└─ Dockerfile{,.worker}
```

`lib/money.ts` is deliberately a single chokepoint. If money arithmetic is scattered across components, §5.1 will be violated within a week.

---

## 11. Environment

```bash
DATABASE_URL="postgresql://nori:nori@localhost:5432/nori"

AUTH_SECRET=              # openssl rand -base64 32
AUTH_URL="http://localhost:3000"
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
EMAIL_SERVER="smtp://localhost:1025"    # Mailhog in dev
EMAIL_FROM="Nori <noreply@nori.local>"

S3_ENDPOINT="http://localhost:9000"     # MinIO
S3_REGION="us-east-1"
S3_BUCKET="nori-receipts"
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE="true"              # required for MinIO

OPENAI_API_KEY=
OPENAI_EXTRACT_MODEL="gpt-4.1-mini"
OPENAI_SUMMARY_MODEL="gpt-4.1-mini"

MAX_UPLOAD_BYTES="10485760"
DAILY_RECEIPT_LIMIT="200"
OCR_WORKER_POOL_SIZE="2"
```

Validate all of these through a Zod schema in `lib/env.ts` that runs at boot. Fail loudly at startup, not on the first user upload at 2am.

**MinIO setup:** bucket private, no public read. Access is exclusively via presigned URLs (PUT for upload, GET for display, 15-minute expiry). Set a lifecycle rule to purge orphaned objects with no `Receipt` row after 24h.

---

## 12. Build phases

Each phase ends in something demonstrable. Do not start a phase before its predecessor's acceptance criterion passes.

| # | Phase | Done when |
| --- | --- | --- |
| **0 ✅** | Scaffold: Next.js, TS, Tailwind, shadcn, Compose (postgres + minio), env validation | **Done.** Infra healthy, bucket private, `/` and `/app` render at 200 with no console errors, bad env aborts startup with every problem listed |
| 1 | Auth: Auth.js, Prisma adapter, Google + magic link, workspace bootstrap, middleware | Sign in → personal workspace + seeded categories exist in DB |
| 2 | Storage: presign route, upload UI, `Receipt` row, checksum dedupe | Photo lands in MinIO; duplicate upload returns the existing receipt |
| 3 | OCR: pg-boss, worker service, sharp + tesseract, word bboxes, SSE status | Upload → `ocrText` + `ocrWords` populated; UI shows live stages |
| 4 | Orchestrator: schemas, extract, categorize, reconcile, `ProcessingRun` | Receipt → correct `Expense` + line items on ≥10 fixture receipts |
| 5 | Review screen: two-pane, bbox highlighting, confidence UI, confirm | A real receipt goes photo → confirmed in under 20 seconds |
| 6 | Ledger: receipts list, filters, search, dashboard, charts, export | A month of receipts is browsable and exports cleanly to CSV |
| 7 | Insights + polish: LLM summaries, empty/error states, a11y audit, Playwright E2E | Full flow green on mobile and desktop; a11y audit clean |

**Build the fixture set in phase 3, not phase 7.** Twenty photographed real receipts — crumpled, faded, angled, thermal-print, long, foreign-currency — checked into `tests/fixtures/receipts/` with hand-written expected JSON. Without them, every prompt change in phase 4 is a guess, and you will have no way to tell a real improvement from a lucky sample.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| **Tesseract accuracy on thermal/crumpled receipts is mediocre** — this is the project's central technical risk | Aggressive preprocessing (§6.1); confidence gate (§6.3); a review step that assumes errors. Prototype phase 3 against the worst fixture you own before building phase 4 on top of it. Keep a cloud-OCR adapter (Google Vision / Textract) behind the same interface as an escape hatch |
| LLM invents values from garbage OCR | Nullable-everything schema; confidence gate; deterministic reconciliation (§7.4) |
| Float money corruption | §5.1, enforced through `lib/money.ts` |
| Cross-workspace data leak | `scoped()` helper (§5.4); an E2E test that asserts user B cannot read user A's receipt |
| Worker OOM on large images | Cap upload at 10 MB; downscale to 2000px before Tesseract; memory limit on the worker container |
| Cost runaway | Per-workspace caps, dedupe, merchant-default shortcut, `costMicros` accounting (§7.6) |
| Date-format ambiguity (04/07 — April or July?) | Country inference from merchant address; DD/MM default; lowered confidence forces human review |

---

## 14. As-built deviations

Recorded as they happen, so this document does not quietly drift out of date.

| # | Planned | Built | Why |
| --- | --- | --- | --- |
| 1 | Next.js 15 | Next.js 16.2.12 + Turbopack | `create-next-app@latest`. No API changes affecting this design. |
| 2 | `docker-compose.yml` runs `app` + `worker` | Compose runs **backing services only**; app and worker run on the host | Bind mounts plus `node_modules` in a Linux container on Windows makes hot reload unusably slow. Production images stay planned for `docker-compose.prod.yml`. |
| 3 | `import "server-only"` guards `lib/env.ts` | Explicit `typeof window` check | `server-only` throws under every module condition except `react-server`, which would make `lib/env.ts` unimportable from the standalone OCR worker in phase 3. The manual check gives the same protection in both runtimes. |
| 4 | `OPENAI_API_KEY` required | Optional, with a boot warning and `hasOpenAI` flag | §7.7 already requires the LLM step to be disableable; this also lets a contributor run everything through OCR without a billable key. |
| 5 | Playwright in phase 7 | Installed in phase 0 | Used to actually look at the rendered UI rather than assert it from markup. Doubles as the phase 7 E2E harness. |
| 6 | — | Empty-string env vars are stripped before validation | `.env` files write unset keys as `FOO=""`, which Zod treats as present-and-invalid rather than absent. |
| 7 | OpenAI direct | **OpenRouter** (`OPENROUTER_*` env vars) | Requested. Same SDK, different `baseURL`. |
| 8 | Separate `extract` and `categorize` calls (§7) | One call; the extraction schema carries `category` + `categoryReason` | Halves latency and cost on the happy path. `categorize.ts` still lands separately when re-categorisation is needed — on a merchant-default change or a user edit — which is the only case §7.3 actually required a second call for. |
| 9 | Phases in strict order | **Pipeline (phases 3–4) built before auth/storage (phases 1–2)** | Requested: prove receipt-in → analysis-out first. `lib/pipeline/analyze.ts` takes a `Buffer` and knows nothing of sessions, storage or the database, so persistence wraps it later without rework. |
| 10 | SSE for processing status | **NDJSON over the POST response** | `EventSource` cannot issue a POST, and the request *is* a file upload. Same streamed-stage UX, one round trip instead of two. |

**Phase 3 OCR baseline** (`npm run ocr:bench`, 9 synthetic fixtures): mean confidence **88.0/100**; clean 92.6–95.6, simulated thermal 89.1–92.6, angled-and-blurred 73.4–88.9. Worst case sits comfortably above the `OCR_MIN_CONFIDENCE` gate of 40. Preprocessing 49–101 ms, recognition 375–1,872 ms. Re-run this before and after any change to `lib/ocr/preprocess.ts`.

> These fixtures are rendered, then degraded programmatically. They are the floor, not the ceiling — **photographs of genuinely crumpled, faded, real receipts are still needed** before trusting any accuracy claim.

**Known accepted risk:** `nodemailer` GHSA-p6gq-j5cr-w38f (high, no fixed version) — the message-level `raw` option bypasses `disableFileAccess`/`disableUrlAccess`. Not reachable here: magic-link mail is composed entirely server-side and no user input reaches `raw`. Revisit if transactional email ever templates user content.

---

## 15. Open questions

1. **Multi-currency:** v1 stores whatever currency is printed and does not convert. Do totals across mixed currencies need FX conversion, and if so at receipt-date rate or current rate?
2. **Receipt retention:** keep images indefinitely, or purge after N months to limit storage and privacy exposure?
3. **Languages:** English-only Tesseract in v1. Which additional `traineddata` packs, if any?
4. **PDF receipts:** email invoices arrive as PDFs. Add `pdf-to-image` in the preprocess step, or stay images-only for v1?

---

## Appendix A — Build kickoff prompt

Paste this at the start of an implementation session:

> Build **Nori**, a receipt-scanning expenditure tracker, per `docs/SPEC.md` in this repo. Read the whole spec before writing code.
>
> Stack: Next.js 15 App Router + TypeScript strict, Tailwind v4 + shadcn/ui, Auth.js v5 with Prisma adapter and database sessions, PostgreSQL + Prisma, MinIO via S3 SDK presigned URLs, pg-boss queue, a separate Node worker running sharp + tesseract.js, and an OpenAI orchestrator using Structured Outputs.
>
> Work through the phases in §12 in order. Do not start a phase until the previous phase's acceptance criterion actually passes — run it, don't assume it.
>
> Non-negotiable invariants:
> - All money is integer minor units with an explicit currency code, and all money arithmetic goes through `lib/money.ts`. Never a float.
> - Every data query is scoped by `workspaceId` from the session via `scoped()`, never by a client-supplied id.
> - The pipeline never auto-confirms an expense; `NEEDS_REVIEW` is its terminal state.
> - Every LLM extraction field is nullable, and arithmetic validation is deterministic TypeScript, not the model's job.
> - Persist Tesseract word bounding boxes from the start — the review screen depends on them.
>
> Start with phase 0. Show me the Compose file and the env validation schema before moving on.

---

## Appendix B — `docker-compose.yml` sketch

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: nori, POSTGRES_PASSWORD: nori, POSTGRES_DB: nori }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nori"]
      interval: 5s

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: nori, MINIO_ROOT_PASSWORD: noripassword }
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]

  mailhog:
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]

  app:
    build: { context: ., dockerfile: Dockerfile }
    ports: ["3000:3000"]
    depends_on: { postgres: { condition: service_healthy } }
    env_file: .env

  worker:
    build: { context: ., dockerfile: Dockerfile.worker }
    depends_on: { postgres: { condition: service_healthy } }
    env_file: .env
    deploy: { resources: { limits: { memory: 1G } } }

volumes: { pgdata: {}, miniodata: {} }
```

The worker's memory limit is deliberate — it is the only service that loads multi-megabyte images into memory, and an unbounded OOM there should not be able to take the host down.
