-- University rankings become importable through the spreadsheet framework.
--
-- The nullable run id lets an upload stamp its rows so start-over can delete
-- exactly what it wrote. Additive; existing (seeded) rows stay null.
ALTER TABLE "ranked_universities" ADD COLUMN "ingestion_run_id" TEXT;

CREATE INDEX "ranked_universities_ingestion_run_id_idx" ON "ranked_universities"("ingestion_run_id");

ALTER TABLE "ranked_universities" ADD CONSTRAINT "ranked_universities_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
