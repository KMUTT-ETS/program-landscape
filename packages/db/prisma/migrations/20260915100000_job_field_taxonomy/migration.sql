-- packages/db/prisma/migrations/20260915100000_job_field_taxonomy/migration.sql
-- Field-of-study taxonomy for the demand-first Gap Analyzer. Additive only.
--
-- Hand-written to match `prisma migrate diff --from-schema-datasource`.
-- job_field_taxonomy: one row per canonical field; synonyms are the raw
-- JobThai strings it absorbs, GIN-indexed because the map joins postings to
-- fields with the array-overlap operator (required_fields_raw && synonyms).
-- program_job_fields: programme <-> field assignments, unique per pair.

CREATE TYPE "JobFieldReviewStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

CREATE TABLE "job_field_taxonomy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "synonyms" TEXT[],
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "review_status" "JobFieldReviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "method_version" TEXT NOT NULL,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_field_taxonomy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_field_taxonomy_slug_key" ON "job_field_taxonomy"("slug");
CREATE INDEX "job_field_taxonomy_review_status_idx" ON "job_field_taxonomy"("review_status");
CREATE INDEX "job_field_taxonomy_synonyms_gin" ON "job_field_taxonomy" USING GIN ("synonyms");
ALTER TABLE "job_field_taxonomy" ADD CONSTRAINT "job_field_taxonomy_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "program_job_fields" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "review_status" "JobFieldReviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "method_version" TEXT NOT NULL,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "program_job_fields_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "program_job_fields_program_id_field_id_key" ON "program_job_fields"("program_id", "field_id");
CREATE INDEX "program_job_fields_field_id_idx" ON "program_job_fields"("field_id");
ALTER TABLE "program_job_fields" ADD CONSTRAINT "program_job_fields_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_job_fields" ADD CONSTRAINT "program_job_fields_field_id_fkey"
  FOREIGN KEY ("field_id") REFERENCES "job_field_taxonomy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_job_fields" ADD CONSTRAINT "program_job_fields_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
