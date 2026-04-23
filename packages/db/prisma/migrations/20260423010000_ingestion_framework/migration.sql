-- CreateEnum
CREATE TYPE "DataSourceInputFormat" AS ENUM ('JSON', 'CSV', 'XML', 'HTML', 'PDF', 'XLSX', 'MIXED');

-- CreateEnum
CREATE TYPE "IngestionRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'BACKFILL');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable data_sources
-- slug is NOT NULL but existing rows may have no value. Add nullable,
-- backfill from name, then flip to NOT NULL + add unique index. The seed
-- rewrites these rows on the next `pnpm db:seed` anyway.
ALTER TABLE "data_sources" ADD COLUMN "slug" TEXT;
UPDATE "data_sources" SET "slug" = lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')) WHERE "slug" IS NULL;
ALTER TABLE "data_sources" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "data_sources_slug_key" ON "data_sources"("slug");

ALTER TABLE "data_sources" ADD COLUMN "input_format" "DataSourceInputFormat" NOT NULL DEFAULT 'JSON';
ALTER TABLE "data_sources" ADD COLUMN "cadence_cron" TEXT;
ALTER TABLE "data_sources" ADD COLUMN "schedule_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "data_sources" ADD COLUMN "owner_contact" TEXT;

-- CreateIndex on new enum fields
CREATE INDEX "data_sources_input_format_idx" ON "data_sources"("input_format");
CREATE INDEX "data_sources_status_idx" ON "data_sources"("status");

-- CreateTable ingestion_runs
CREATE TABLE "ingestion_runs" (
    "id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "trigger" "IngestionRunTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "triggered_by_user_id" TEXT,
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "records_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_loaded" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "pdf_document_id" TEXT,
    "duration_ms" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error_code" TEXT,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_runs_data_source_id_created_at_idx" ON "ingestion_runs"("data_source_id", "created_at");
CREATE INDEX "ingestion_runs_status_idx" ON "ingestion_runs"("status");
CREATE INDEX "ingestion_runs_created_at_idx" ON "ingestion_runs"("created_at");

-- AddForeignKey
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
