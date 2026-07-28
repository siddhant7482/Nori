-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PREPROCESSING', 'OCR_RUNNING', 'EXTRACTING', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionPath" AS ENUM ('TEXT', 'VISION');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "personal" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'UPLOADED',
    "objectKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "originalName" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "ocrText" TEXT,
    "ocrWords" JSONB,
    "ocrConfidence" DOUBLE PRECISION,
    "ocrEngine" TEXT,
    "extractionPath" "ExtractionPath",
    "pathReason" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "merchantId" TEXT,
    "categoryId" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" INTEGER,
    "taxTotal" INTEGER,
    "tipTotal" INTEGER,
    "total" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "cardLast4" TEXT,
    "notes" TEXT,
    "categoryReason" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "warnings" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "editedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_items" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unitPrice" INTEGER,
    "total" INTEGER NOT NULL,
    "categoryId" TEXT,

    CONSTRAINT "line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "defaultCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "chart" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_runs" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicros" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "rawResponse" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "memberships_workspaceId_idx" ON "memberships"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_workspaceId_key" ON "memberships"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "receipts_workspaceId_status_createdAt_idx" ON "receipts"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_workspaceId_checksumSha256_key" ON "receipts"("workspaceId", "checksumSha256");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_receiptId_key" ON "expenses"("receiptId");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_purchasedAt_idx" ON "expenses"("workspaceId", "purchasedAt");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_categoryId_idx" ON "expenses"("workspaceId", "categoryId");

-- CreateIndex
CREATE INDEX "line_items_expenseId_idx" ON "line_items"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_workspaceId_normalizedName_key" ON "merchants"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "categories_workspaceId_idx" ON "categories"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_workspaceId_slug_key" ON "categories"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "processing_runs_receiptId_createdAt_idx" ON "processing_runs"("receiptId", "createdAt");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
