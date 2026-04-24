-- Program management (admin CRUD + curriculum PDF attachment).
-- Adds มคอ.2 header fields to Program + new ProgramDocument join table that
-- tracks curriculum-PDF (and supporting-doc) attachments with role + history.

-- CreateEnum ProgramDocumentRole
CREATE TYPE "ProgramDocumentRole" AS ENUM (
  'CURRENT_CURRICULUM',
  'PREVIOUS_CURRICULUM',
  'COMMITTEE_ORDER',
  'EVALUATION_REPORT',
  'SUPPLEMENTARY'
);

-- AlterTable programs — add มคอ.2 header columns. All nullable so existing
-- seeded rows stay valid; admin fills them in via the new edit page or by
-- applying a reviewed CURRICULUM_SPEC extraction.
ALTER TABLE "programs"
  ADD COLUMN "degree_name_th"              TEXT,
  ADD COLUMN "degree_name_en"              TEXT,
  ADD COLUMN "degree_abbr_th"              TEXT,
  ADD COLUMN "degree_abbr_en"              TEXT,
  ADD COLUMN "majors"                      TEXT[]  DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "total_credits"               INTEGER,
  ADD COLUMN "duration_years"              INTEGER,
  ADD COLUMN "program_plans"               TEXT[]  DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "language"                    TEXT,
  ADD COLUMN "admission_scope"             TEXT,
  ADD COLUMN "careers_th_json"             JSONB,
  ADD COLUMN "opening_year"                INTEGER,
  ADD COLUMN "opening_semester"            INTEGER,
  ADD COLUMN "curriculum_year_be"          INTEGER,
  ADD COLUMN "is_revision"                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "previous_curriculum_year_be" INTEGER,
  ADD COLUMN "approval_history_json"       JSONB;

-- CreateTable program_documents
CREATE TABLE "program_documents" (
  "id"                 TEXT                  NOT NULL,
  "program_id"         TEXT                  NOT NULL,
  "pdf_document_id"    TEXT                  NOT NULL,
  "role"               "ProgramDocumentRole" NOT NULL,
  "curriculum_year_be" INTEGER,
  "is_current"         BOOLEAN               NOT NULL DEFAULT false,
  "notes"              TEXT,
  "attached_by_id"     TEXT,
  "attached_at"        TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "program_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex program_documents
CREATE UNIQUE INDEX "program_documents_program_id_pdf_document_id_key"
  ON "program_documents"("program_id", "pdf_document_id");
CREATE INDEX "program_documents_program_id_idx"      ON "program_documents"("program_id");
CREATE INDEX "program_documents_pdf_document_id_idx" ON "program_documents"("pdf_document_id");
CREATE INDEX "program_documents_role_idx"            ON "program_documents"("role");

-- AddForeignKey program_documents
ALTER TABLE "program_documents"
  ADD CONSTRAINT "program_documents_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_documents"
  ADD CONSTRAINT "program_documents_pdf_document_id_fkey"
  FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_documents"
  ADD CONSTRAINT "program_documents_attached_by_id_fkey"
  FOREIGN KEY ("attached_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
