-- job_postings gains an ingestion_run_id.
--
-- The table predates the provenance convention and had no such column, so
-- nothing written to it could ever pass realDataWhere() — the same class of
-- gap that left 6,224 program_demand_matches invisible to the relevance
-- dimension. Added alongside the first connector that actually writes here.
--
-- Additive: nullable column, index, SET NULL foreign key.

-- AlterTable
ALTER TABLE "job_postings" ADD COLUMN "ingestion_run_id" TEXT;

-- CreateIndex
CREATE INDEX "job_postings_ingestion_run_id_idx" ON "job_postings"("ingestion_run_id");

-- AddForeignKey
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
