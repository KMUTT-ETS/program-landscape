-- CreateEnum
CREATE TYPE "PdfLifecycleStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DEPRECATED');

-- AlterTable
ALTER TABLE "pdf_documents"
  ADD COLUMN "lifecycle_status"        "PdfLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "lifecycle_note"          TEXT,
  ADD COLUMN "lifecycle_changed_at"    TIMESTAMP(3),
  ADD COLUMN "lifecycle_changed_by_id" TEXT;

-- CreateIndex
CREATE INDEX "pdf_documents_lifecycle_status_idx" ON "pdf_documents"("lifecycle_status");
