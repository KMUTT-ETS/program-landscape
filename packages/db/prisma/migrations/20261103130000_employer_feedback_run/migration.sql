-- Employer feedback becomes importable through the spreadsheet framework.
--
-- The table had no writer and no provenance. The nullable run id lets the
-- import stamp its rows (so realDataWhere() shows them, and start-over can
-- delete exactly what an upload wrote). Additive; existing rows stay null.
ALTER TABLE "employer_feedback" ADD COLUMN "ingestion_run_id" TEXT;

CREATE INDEX "employer_feedback_ingestion_run_id_idx" ON "employer_feedback"("ingestion_run_id");

ALTER TABLE "employer_feedback" ADD CONSTRAINT "employer_feedback_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
