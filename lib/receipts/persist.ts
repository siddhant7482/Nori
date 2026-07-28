import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/db/scope";
import type { AnalyzeResult } from "@/lib/pipeline/analyze";

/**
 * Persists a pipeline result against a workspace.
 *
 * Everything here is scoped by `scope.workspaceId`, taken from the session —
 * never from the request. See lib/db/scope.ts.
 */

export function checksumOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Match key for merchants: "Tesco Express #4417" -> "tescoexpress4417". */
function normalizeMerchant(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function findExistingByChecksum(
  scope: Scope,
  checksum: string,
) {
  return prisma.receipt.findUnique({
    where: {
      workspaceId_checksumSha256: {
        workspaceId: scope.workspaceId,
        checksumSha256: checksum,
      },
    },
    include: { expense: { include: { lineItems: true } } },
  });
}

export async function persistAnalysis(input: {
  scope: Scope;
  result: AnalyzeResult;
  checksum: string;
  file: { name: string; mimeType: string; size: number };
}) {
  const { scope, result, checksum, file } = input;

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.create({
      data: {
        workspaceId: scope.workspaceId,
        uploadedById: scope.userId,
        status: result.ok ? "NEEDS_REVIEW" : "FAILED",

        mimeType: file.mimeType,
        byteSize: file.size,
        checksumSha256: checksum,
        originalName: file.name,

        imageWidth: result.ocr.width || null,
        imageHeight: result.ocr.height || null,
        ocrText: result.ocr.text || null,
        // Word boxes drive the review screen's field-to-image highlighting
        // (spec §8.5). They cost nothing to store and cannot be recovered
        // later without re-running OCR.
        ocrWords: result.ocr.words.length
          ? (result.ocr.words as unknown as Prisma.InputJsonValue)
          : undefined,
        ocrConfidence: result.ocr.confidence || null,
        ocrEngine: result.ocr.engine || null,

        extractionPath:
          result.path === "vision"
            ? "VISION"
            : result.path === "text"
              ? "TEXT"
              : null,
        pathReason: result.pathReason ?? null,

        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        processedAt: new Date(),
      },
    });

    // Observability row per run — how a bad extraction gets debugged and how
    // spend is accounted for after the fact (spec §5.3).
    await tx.processingRun.create({
      data: {
        receiptId: receipt.id,
        stage: result.path === "vision" ? "extract-vision" : "extract",
        status: result.ok ? "ok" : "error",
        model: result.usage?.model ?? null,
        promptVersion: result.promptVersion ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        latencyMs: result.timings.total ?? 0,
        error: result.errorMessage ?? null,
      },
    });

    if (!result.ok || !result.receipt) {
      return { receipt, expense: null };
    }

    const r = result.receipt;
    const currency = r.currency ?? "GBP";

    // A total is structurally required by Expense. Without one there is
    // nothing to file, so the receipt stays FAILED rather than becoming a
    // row with a fabricated zero in the ledger.
    if (r.total === null) {
      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: "FAILED",
          errorCode: "NO_TOTAL",
          errorMessage: "No total could be read from this receipt.",
        },
      });
      return { receipt, expense: null };
    }

    // Merchants are per-workspace and remembered, so a later correction to
    // this shop's category can apply to every future receipt from it (§7.5).
    let merchantId: string | null = null;
    if (r.merchantName?.trim()) {
      const normalized = normalizeMerchant(r.merchantName);
      if (normalized) {
        const merchant = await tx.merchant.upsert({
          where: {
            workspaceId_normalizedName: {
              workspaceId: scope.workspaceId,
              normalizedName: normalized,
            },
          },
          create: {
            workspaceId: scope.workspaceId,
            name: r.merchantName.trim(),
            normalizedName: normalized,
          },
          update: {},
        });
        merchantId = merchant.id;
      }
    }

    const category = r.category
      ? await tx.category.findFirst({
          where: { workspaceId: scope.workspaceId, slug: r.category },
          select: { id: true },
        })
      : null;

    const expense = await tx.expense.create({
      data: {
        workspaceId: scope.workspaceId,
        receiptId: receipt.id,
        merchantId,
        categoryId: category?.id ?? null,

        // Fall back to now only when the date is genuinely unreadable; the
        // warning list already tells the reviewer it needs attention.
        purchasedAt: r.purchasedAt ? new Date(r.purchasedAt) : new Date(),
        currency,
        subtotal: r.subtotal,
        taxTotal: r.taxTotal,
        tipTotal: r.tipTotal,
        total: r.total,

        paymentMethod: r.paymentMethod,
        cardLast4: r.cardLast4,
        categoryReason: r.categoryReason,
        confidence: result.meanConfidence ?? 0,
        needsReview: result.needsReview,
        warnings: result.warnings as unknown as Prisma.InputJsonValue,

        lineItems: {
          create: r.lineItems.map((li, i) => ({
            lineNumber: i + 1,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            total: li.total,
          })),
        },
      },
      include: { lineItems: true },
    });

    return { receipt, expense };
  });
}
