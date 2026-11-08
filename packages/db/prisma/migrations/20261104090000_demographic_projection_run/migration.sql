-- Population projections gain provenance.
--
-- The UN WPP pull and the population spreadsheet stamp their rows with the
-- run that wrote them, so start-over and the connector's snapshot replace can
-- delete exactly their own rows. Additive; seeded rows stay null.
ALTER TABLE "demographic_projections" ADD COLUMN "ingestion_run_id" TEXT;

CREATE INDEX "demographic_projections_ingestion_run_id_idx" ON "demographic_projections"("ingestion_run_id");

ALTER TABLE "demographic_projections" ADD CONSTRAINT "demographic_projections_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
