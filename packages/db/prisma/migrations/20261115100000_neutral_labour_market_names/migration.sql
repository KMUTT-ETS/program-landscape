-- Source-neutral names for the labour-market careers and skills tables.
--
-- These tables were named after the first feeder, the KMITL Skill Mapping API
-- (`kmitl-skill-mapping`, now deprecated). They are now loaded from the Career
-- Skill Demand spreadsheet, whose data can come from any source, so nothing in
-- the schema names a provider any more. Pure renames: no data moves, no type
-- changes, and every row (including its ingestion_run_id provenance) is kept.
--
-- kmitl_careers                -> labour_market_careers
-- kmitl_career_skill_demands   -> labour_market_skill_demands
-- kmitl_skill_growths          -> labour_market_skill_growths
-- kmitl_data_scope (enum)      -> labour_market_data_scope
-- kmitl_demand_source (enum)   -> labour_market_demand_source
-- *.kmitl_career_id            -> source_career_id
-- kmitl_careers.kmitl_group_id / kmitl_sub_group_id -> source_group_id / source_sub_group_id
-- programs.kmitl_career_ids    -> labour_market_career_ids

-- Enums
ALTER TYPE "kmitl_data_scope" RENAME TO "labour_market_data_scope";
ALTER TYPE "kmitl_demand_source" RENAME TO "labour_market_demand_source";

-- Tables
ALTER TABLE "kmitl_careers" RENAME TO "labour_market_careers";
ALTER TABLE "kmitl_career_skill_demands" RENAME TO "labour_market_skill_demands";
ALTER TABLE "kmitl_skill_growths" RENAME TO "labour_market_skill_growths";

-- Columns
ALTER TABLE "labour_market_careers" RENAME COLUMN "kmitl_career_id" TO "source_career_id";
ALTER TABLE "labour_market_careers" RENAME COLUMN "kmitl_group_id" TO "source_group_id";
ALTER TABLE "labour_market_careers" RENAME COLUMN "kmitl_sub_group_id" TO "source_sub_group_id";
ALTER TABLE "labour_market_skill_demands" RENAME COLUMN "kmitl_career_id" TO "source_career_id";
ALTER TABLE "programs" RENAME COLUMN "kmitl_career_ids" TO "labour_market_career_ids";

-- Primary keys and foreign keys (constraint names)
ALTER TABLE "labour_market_careers" RENAME CONSTRAINT "kmitl_careers_pkey" TO "labour_market_careers_pkey";
ALTER TABLE "labour_market_careers" RENAME CONSTRAINT "kmitl_careers_ingestion_run_id_fkey" TO "labour_market_careers_ingestion_run_id_fkey";
ALTER TABLE "labour_market_skill_demands" RENAME CONSTRAINT "kmitl_career_skill_demands_pkey" TO "labour_market_skill_demands_pkey";
ALTER TABLE "labour_market_skill_demands" RENAME CONSTRAINT "kmitl_career_skill_demands_career_id_fkey" TO "labour_market_skill_demands_career_id_fkey";
ALTER TABLE "labour_market_skill_demands" RENAME CONSTRAINT "kmitl_career_skill_demands_skill_id_fkey" TO "labour_market_skill_demands_skill_id_fkey";
ALTER TABLE "labour_market_skill_demands" RENAME CONSTRAINT "kmitl_career_skill_demands_ingestion_run_id_fkey" TO "labour_market_skill_demands_ingestion_run_id_fkey";
ALTER TABLE "labour_market_skill_growths" RENAME CONSTRAINT "kmitl_skill_growths_pkey" TO "labour_market_skill_growths_pkey";
ALTER TABLE "labour_market_skill_growths" RENAME CONSTRAINT "kmitl_skill_growths_skill_id_fkey" TO "labour_market_skill_growths_skill_id_fkey";
ALTER TABLE "labour_market_skill_growths" RENAME CONSTRAINT "kmitl_skill_growths_ingestion_run_id_fkey" TO "labour_market_skill_growths_ingestion_run_id_fkey";

-- Indexes (unique indexes included)
ALTER INDEX "kmitl_careers_kmitl_career_id_key" RENAME TO "labour_market_careers_source_career_id_key";
ALTER INDEX "kmitl_careers_kmitl_group_id_kmitl_sub_group_id_idx" RENAME TO "labour_market_careers_source_group_id_source_sub_group_id_idx";
ALTER INDEX "kmitl_careers_ingestion_run_id_idx" RENAME TO "labour_market_careers_ingestion_run_id_idx";
ALTER INDEX "kmitl_career_skill_demands_kmitl_career_id_skill_name_raw_d_key" RENAME TO "labour_market_skill_demands_source_career_id_skill_name_raw_key";
ALTER INDEX "kmitl_career_skill_demands_career_id_idx" RENAME TO "labour_market_skill_demands_career_id_idx";
ALTER INDEX "kmitl_career_skill_demands_skill_id_idx" RENAME TO "labour_market_skill_demands_skill_id_idx";
ALTER INDEX "kmitl_career_skill_demands_data_scope_data_source_idx" RENAME TO "labour_market_skill_demands_data_scope_data_source_idx";
ALTER INDEX "kmitl_career_skill_demands_snapshot_at_idx" RENAME TO "labour_market_skill_demands_snapshot_at_idx";
ALTER INDEX "kmitl_career_skill_demands_ingestion_run_id_idx" RENAME TO "labour_market_skill_demands_ingestion_run_id_idx";
ALTER INDEX "kmitl_skill_growths_context_level_context_id_skill_name_raw_key" RENAME TO "labour_market_skill_growths_context_level_context_id_skill__key";
ALTER INDEX "kmitl_skill_growths_skill_id_idx" RENAME TO "labour_market_skill_growths_skill_id_idx";
ALTER INDEX "kmitl_skill_growths_snapshot_at_idx" RENAME TO "labour_market_skill_growths_snapshot_at_idx";
ALTER INDEX "kmitl_skill_growths_ingestion_run_id_idx" RENAME TO "labour_market_skill_growths_ingestion_run_id_idx";
