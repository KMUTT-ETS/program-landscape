-- CreateEnum
CREATE TYPE "TrendDocumentSourceType" AS ENUM ('FILE', 'URL');

-- CreateEnum
CREATE TYPE "TrendDocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "trend_documents" (
    "id" TEXT NOT NULL,
    "source_type" "TrendDocumentSourceType" NOT NULL,
    "status" "TrendDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "original_filename" TEXT,
    "storage_url" TEXT,
    "content_hash" TEXT,
    "file_size" INTEGER,
    "source_url" TEXT,
    "signal_type_hint" TEXT,
    "trend_signal_id" TEXT,
    "error" TEXT,
    "uploaded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trend_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trend_documents_status_idx" ON "trend_documents"("status");

-- CreateIndex
CREATE INDEX "trend_documents_created_at_idx" ON "trend_documents"("created_at");

-- CreateIndex
CREATE INDEX "trend_documents_content_hash_idx" ON "trend_documents"("content_hash");
