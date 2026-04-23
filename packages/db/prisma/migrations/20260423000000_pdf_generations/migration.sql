-- CreateEnum
CREATE TYPE "PdfGenerationStatus" AS ENUM ('QUEUED', 'RENDERING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "pdf_generations" (
    "id" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "template_version" TEXT NOT NULL,
    "requester_id" TEXT,
    "scope_level" TEXT,
    "scope_id" TEXT,
    "data_hash" TEXT NOT NULL,
    "status" "PdfGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "byte_size" INTEGER,
    "page_count" INTEGER,
    "generation_duration_ms" INTEGER,
    "storage_bucket" TEXT,
    "storage_key" TEXT,
    "gotenberg_request_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pdf_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pdf_generations_template_name_created_at_idx" ON "pdf_generations"("template_name", "created_at");

-- CreateIndex
CREATE INDEX "pdf_generations_requester_id_created_at_idx" ON "pdf_generations"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "pdf_generations_status_idx" ON "pdf_generations"("status");

-- AddForeignKey
ALTER TABLE "pdf_generations" ADD CONSTRAINT "pdf_generations_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
