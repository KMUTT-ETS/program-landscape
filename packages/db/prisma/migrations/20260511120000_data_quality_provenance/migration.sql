-- Migration: 20260511120000_data_quality_provenance
--
-- Closes the Tier-1 gaps from docs/evaluation-pipeline.md §13:
--
--   GAP 1 — Mock-data contamination
--   GAP 2 — Provenance chain holes
--
-- ── What this migration does ───────────────────────────────────────
--
-- 1. Adds `mocked` BOOLEAN to `data_sources`. The mocked state was
--    previously a free-text convention (`status='mocked'`); this
--    promotes it to an explicit, indexable column. The catalog
--    seeder (packages/shared/src/ingestion/catalog.ts) will keep
--    it in sync on subsequent runs.
--
-- 2. Adds `ingestion_run_id TEXT NULL REFERENCES ingestion_runs(id)`
--    to 15 metric/fact tables. Same shape as the 5 staff/student
--    raw-record cubes already in production. Every row written by
--    the connector runner from this point forward should populate
--    the column.
--
-- ── Backfill policy ────────────────────────────────────────────────
--
-- Historical rows keep `ingestion_run_id = NULL`. The data-quality.v1
-- helper at packages/db/src/data-quality.ts treats NULL as "legacy
-- real" until a separate provenance-backfill migration lands. The
-- alternative (strict — treat NULL as mock) would silently void the
-- entire historical portfolio on the day this migration lands.
--
-- Flip to strict (NULL → mock) in a follow-up migration once
-- backfill is complete.
--
-- ── Safety ─────────────────────────────────────────────────────────
--
-- Pure additive. No data destruction. All new columns are NULL by
-- default with ON DELETE SET NULL on the FK. Reversible by dropping
-- the columns + constraints (rollback path documented in §13 of the
-- evaluation pipeline doc).

-- ═══════════════════════════════════════════════════════════════════
-- Part 1 — DataSource.mocked
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "data_sources"
  ADD COLUMN "mocked" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the existing free-text status convention. Catalog
-- seeder picks up the source of truth on the next pnpm db:seed.
UPDATE "data_sources"
SET "mocked" = true
WHERE "status" = 'mocked';

CREATE INDEX "data_sources_mocked_idx" ON "data_sources" ("mocked");

-- ═══════════════════════════════════════════════════════════════════
-- Part 2 — ingestion_run_id on 15 metric/fact tables
-- ═══════════════════════════════════════════════════════════════════
--
-- Pattern per table:
--   - ADD COLUMN ingestion_run_id TEXT NULL
--   - ADD FOREIGN KEY ON DELETE SET NULL
--   - CREATE INDEX on the FK column
--
-- Constraint names follow Prisma's convention:
--   <table>_ingestion_run_id_fkey  (FK)
--   <table>_ingestion_run_id_idx   (index)

-- 1. enrollment_metrics — Health attractiveness + Risk L1 + BCG quadrant
ALTER TABLE "enrollment_metrics" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "enrollment_metrics" ADD CONSTRAINT "enrollment_metrics_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "enrollment_metrics_ingestion_run_id_idx" ON "enrollment_metrics" ("ingestion_run_id");

-- 2. student_demographics — cohort histograms; freshness via this FK
ALTER TABLE "student_demographics" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "student_demographics" ADD CONSTRAINT "student_demographics_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "student_demographics_ingestion_run_id_idx" ON "student_demographics" ("ingestion_run_id");

-- 3. tcas_admission_stats — peer rows for Attractiveness peer comparison + Outcomes percentile
ALTER TABLE "tcas_admission_stats" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "tcas_admission_stats" ADD CONSTRAINT "tcas_admission_stats_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tcas_admission_stats_ingestion_run_id_idx" ON "tcas_admission_stats" ("ingestion_run_id");

-- 4. alumni_cohort_statuses — Deep-Dive Demand Funnel exit-status buckets
ALTER TABLE "alumni_cohort_statuses" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "alumni_cohort_statuses" ADD CONSTRAINT "alumni_cohort_statuses_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "alumni_cohort_statuses_ingestion_run_id_idx" ON "alumni_cohort_statuses" ("ingestion_run_id");

-- 5. student_cohort_distributions — Lifecycle delayed-graduation driver
ALTER TABLE "student_cohort_distributions" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "student_cohort_distributions" ADD CONSTRAINT "student_cohort_distributions_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "student_cohort_distributions_ingestion_run_id_idx" ON "student_cohort_distributions" ("ingestion_run_id");

-- 6. financial_metrics — Health Financial dimension + Risk I1+I2
ALTER TABLE "financial_metrics" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "financial_metrics_ingestion_run_id_idx" ON "financial_metrics" ("ingestion_run_id");

-- 7. graduate_outcomes — Health Outcomes dimension (currently mocked → kku-alumni)
ALTER TABLE "graduate_outcomes" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "graduate_outcomes" ADD CONSTRAINT "graduate_outcomes_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "graduate_outcomes_ingestion_run_id_idx" ON "graduate_outcomes" ("ingestion_run_id");

-- 8. research_outputs — Health Capability publications + AI readiness research presence
ALTER TABLE "research_outputs" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "research_outputs" ADD CONSTRAINT "research_outputs_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "research_outputs_ingestion_run_id_idx" ON "research_outputs" ("ingestion_run_id");

-- 9. faculty_compensation — Cost-allocation methodology input (note: singular @@map)
ALTER TABLE "faculty_compensation" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "faculty_compensation" ADD CONSTRAINT "faculty_compensation_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "faculty_compensation_ingestion_run_id_idx" ON "faculty_compensation" ("ingestion_run_id");

-- 10. faculty_budgets — Cost-allocation methodology input
ALTER TABLE "faculty_budgets" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "faculty_budgets" ADD CONSTRAINT "faculty_budgets_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "faculty_budgets_ingestion_run_id_idx" ON "faculty_budgets" ("ingestion_run_id");

-- 11. kmitl_careers — Relevance dimension career taxonomy
ALTER TABLE "kmitl_careers" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "kmitl_careers" ADD CONSTRAINT "kmitl_careers_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "kmitl_careers_ingestion_run_id_idx" ON "kmitl_careers" ("ingestion_run_id");

-- 12. kmitl_career_skill_demands — Relevance labour_market_alignment driver
ALTER TABLE "kmitl_career_skill_demands" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "kmitl_career_skill_demands" ADD CONSTRAINT "kmitl_career_skill_demands_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "kmitl_career_skill_demands_ingestion_run_id_idx" ON "kmitl_career_skill_demands" ("ingestion_run_id");

-- 13. kmitl_skill_growths — Trends radar skill-growth signal
ALTER TABLE "kmitl_skill_growths" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "kmitl_skill_growths" ADD CONSTRAINT "kmitl_skill_growths_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "kmitl_skill_growths_ingestion_run_id_idx" ON "kmitl_skill_growths" ("ingestion_run_id");

-- 14. tcas_admission_funnels — Health attractiveness + Risk L1 + L3
ALTER TABLE "tcas_admission_funnels" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "tcas_admission_funnels" ADD CONSTRAINT "tcas_admission_funnels_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tcas_admission_funnels_ingestion_run_id_idx" ON "tcas_admission_funnels" ("ingestion_run_id");

-- 15. program_demand_matches — Relevance demand_match_filled driver
ALTER TABLE "program_demand_matches" ADD COLUMN "ingestion_run_id" TEXT;
ALTER TABLE "program_demand_matches" ADD CONSTRAINT "program_demand_matches_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "program_demand_matches_ingestion_run_id_idx" ON "program_demand_matches" ("ingestion_run_id");
