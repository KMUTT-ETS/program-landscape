-- CreateEnum
CREATE TYPE "ProgramRevisionStatus" AS ENUM ('DRAFT', 'ANALYSING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "program_revisions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "source_pdf_document_id" TEXT,
    "curriculum_year_be" INTEGER,
    "status" "ProgramRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "metadata_proposal_json" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "program_revisions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "programs" ADD COLUMN "active_revision_id" TEXT;

-- CreateIndex
CREATE INDEX "program_revisions_program_id_created_at_idx" ON "program_revisions"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "program_revisions_status_idx" ON "program_revisions"("status");

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_source_pdf_document_id_fkey" FOREIGN KEY ("source_pdf_document_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
