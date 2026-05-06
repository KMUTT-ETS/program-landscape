-- Add PLAN_PER_YEAR (the registrar's actual annual seat target) to the
-- TCAS funnel. Column is nullable in the source view; same here.
-- Existing rows get NULL until the next ingestion fills them.
ALTER TABLE "tcas_admission_funnels" ADD COLUMN "plan_per_year" INTEGER;
