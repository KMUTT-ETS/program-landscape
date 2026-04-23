-- AlterEnum: add JOB_POSTINGS_BATCH
ALTER TYPE "PdfSourceCategory" ADD VALUE 'JOB_POSTINGS_BATCH';

-- AlterTable pdf_documents
ALTER TABLE "pdf_documents" ADD COLUMN "source_category_hint" "PdfSourceCategory";
ALTER TABLE "pdf_documents" ADD COLUMN "processing_error" TEXT;
ALTER TABLE "pdf_documents" ADD COLUMN "classification_confidence" DOUBLE PRECISION;

-- AlterTable pdf_extractions
ALTER TABLE "pdf_extractions" ADD COLUMN "reasoning" TEXT;
ALTER TABLE "pdf_extractions" ADD COLUMN "review_notes" TEXT;
