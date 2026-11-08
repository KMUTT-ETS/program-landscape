-- Spreadsheet import, phase 1: the batch ledger plus provenance columns on
-- the four org-backbone tables the importer writes.
--
-- Every column added here is nullable and every FK is ON DELETE SET NULL, so
-- nothing existing changes behaviour. realDataWhere() is never applied to
-- faculties / departments / programs / faculty_members; the provenance column
-- exists so "start over" can delete the rows the importer wrote and leave
-- seeded and connector-written rows alone.

CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'LOADING', 'SUCCEEDED', 'FAILED', 'CLEARED');

CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "dataset_slug" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "uploaded_by_user_id" TEXT,
    "ingestion_run_id" TEXT,
    "cleared_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- Per dataset, not global: the same workbook may legitimately be uploaded to
-- two different datasets.
CREATE UNIQUE INDEX "import_batches_dataset_slug_content_hash_key"
    ON "import_batches" ("dataset_slug", "content_hash");
CREATE INDEX "import_batches_dataset_slug_created_at_idx"
    ON "import_batches" ("dataset_slug", "created_at");
CREATE INDEX "import_batches_ingestion_run_id_idx"
    ON "import_batches" ("ingestion_run_id");

ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_user_id_fkey"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provenance columns.
ALTER TABLE "faculties"       ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "departments"     ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "programs"        ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "faculty_members" ADD COLUMN "ingestion_run_id" TEXT;

CREATE INDEX "faculties_ingestion_run_id_idx"       ON "faculties" ("ingestion_run_id");
CREATE INDEX "departments_ingestion_run_id_idx"     ON "departments" ("ingestion_run_id");
CREATE INDEX "programs_ingestion_run_id_idx"        ON "programs" ("ingestion_run_id");
CREATE INDEX "faculty_members_ingestion_run_id_idx" ON "faculty_members" ("ingestion_run_id");

ALTER TABLE "faculties" ADD CONSTRAINT "faculties_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "programs" ADD CONSTRAINT "programs_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
