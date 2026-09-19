# The receipt engine (parked)

Nori's first life was a hackathon receipt scanner. When Nori became a CommandHQ app the
bank feed became the record, and receipts became optional enrichment: a photo or an email
that adds line items, a warranty date or a price to a payment Monzo already knows about.

This engine is kept whole, unused, until that phase is built. It is excluded from the app's
TypeScript build (`tsconfig.json` → `exclude`), so it can't break the app while it waits,
and its imports and env still point at the hackathon layout. The hackathon build it came
from is tagged `hackathon` in git.

When it comes back, receipts are MATCHED onto Monzo transactions (amount, a date within a
few days, the card's last four digits), images go to Vault through its `/api/refs`, and
`persist.ts` is rewritten against Drizzle.

## How it works

```
image ──► sharp preprocess ──► Tesseract OCR ──► confidence routing ──┐
                                                                      │
         confidence ≥ threshold ──► text extraction   (OCR text → LLM)
         confidence <  threshold ──► vision extraction (image → LLM)
                          │
                          ▼
              deterministic reconciliation
                 (arithmetic, dates, currency)
```

**Every extracted field is nullable.** A model allowed to answer "I could not read that"
invents far fewer values than one forced to produce a string.

**Arithmetic is not the model's job.** Plain TypeScript checks that line items sum to the
subtotal and that subtotal + tax + tip equals the total. Both the US additive-tax and the
UK/EU VAT-inclusive conventions are accepted.

**Nothing auto-confirms.** A person always sees the numbers once.

## Measured behaviour

Benchmarked over 183 real receipt photographs: handheld, angled, cluttered, faded thermal.

| | |
| --- | --- |
| OCR confidence | mean **64.5**, median 66.0, p10 45.9, max 90.8 |
| Below the usable gate (40) | 8 / 183 (4.4%) |
| OCR time | ~913 ms mean |

- **Synthetic fixtures are not a substitute for real photographs.** The generated fixtures
  in `tests/fixtures/` score 88.0 mean; real receipts score 64.5.
- **A plausible preprocessing theory was wrong.** Extracting the red channel to darken
  blue thermal ink won on 14 of 36 images but lost 1.9 points overall. Greyscale stayed.

The benchmarks read `receipts_train/`, a third-party dataset that is not in this repository.
