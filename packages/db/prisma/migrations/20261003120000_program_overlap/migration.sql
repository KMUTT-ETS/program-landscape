-- program-overlap.v1: PLOs, market profiles, overlap runs/pairs/recommendations,
-- plus description/CLO/embedding columns on program_courses. Additive only.

-- CreateEnum
CREATE TYPE "OverlapAction" AS ENUM ('COORDINATE_SHARED_COURSES', 'CONSOLIDATE_EQUIVALENT_COURSES', 'SHARE_STAFF_RESOURCES', 'DIFFERENTIATE', 'CONSIDER_MERGE_OR_TRACK');

-- CreateEnum
CREATE TYPE "OverlapBand" AS ENUM ('HIGH', 'MODERATE', 'LOW', 'NONE');

-- CreateEnum
CREATE TYPE "OverlapRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "program_courses" ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "embedding_text_hash" TEXT,
ADD COLUMN     "learning_outcomes_th" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "program_learning_outcomes" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text_th" TEXT NOT NULL,
    "text_normalised" TEXT NOT NULL,
    "program_revision_id" TEXT,
    "source_extraction_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "embedding_text_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_learning_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_market_profiles" (
    "program_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding" vector(1536),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_market_profiles_pkey" PRIMARY KEY ("program_id")
);

-- CreateTable
CREATE TABLE "program_overlap_runs" (
    "id" TEXT NOT NULL,
    "methodology_version" TEXT NOT NULL,
    "level" "ProgramLevel",
    "scope_program_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "OverlapRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "pairs_scored" INTEGER NOT NULL DEFAULT 0,
    "pairs_stored" INTEGER NOT NULL DEFAULT 0,
    "thresholds_json" JSONB NOT NULL,
    "coverage_json" JSONB,
    "error_text" TEXT,

    CONSTRAINT "program_overlap_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_overlap_pairs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "level" "ProgramLevel" NOT NULL,
    "program_a_id" TEXT NOT NULL,
    "program_b_id" TEXT NOT NULL,
    "structure" DOUBLE PRECISION,
    "content" DOUBLE PRECISION,
    "outcome" DOUBLE PRECISION,
    "overlap_index" DOUBLE PRECISION,
    "containment_a_in_b" DOUBLE PRECISION,
    "containment_b_in_a" DOUBLE PRECISION,
    "band" "OverlapBand" NOT NULL,
    "shared_credits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "equiv_credits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shared_staff" INTEGER NOT NULL DEFAULT 0,
    "market_similarity" DOUBLE PRECISION,
    "language_variant" BOOLEAN NOT NULL DEFAULT false,
    "actions" "OverlapAction"[] DEFAULT ARRAY[]::"OverlapAction"[],
    "primary_action" "OverlapAction",
    "evidence_json" JSONB NOT NULL,
    "evidence_hash" TEXT NOT NULL,
    "methodology_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_overlap_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_overlap_recommendations" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "distinctive_a" TEXT NOT NULL,
    "distinctive_b" TEXT NOT NULL,
    "next_steps" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "disagrees_with_action" BOOLEAN NOT NULL DEFAULT false,
    "disagreement_reason" TEXT,
    "prompt_version" TEXT NOT NULL,
    "ai_inference_id" TEXT,
    "evidence_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_overlap_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_learning_outcomes_program_id_idx" ON "program_learning_outcomes"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_learning_outcomes_program_id_ordinal_key" ON "program_learning_outcomes"("program_id", "ordinal");

-- CreateIndex
CREATE INDEX "program_overlap_runs_status_level_completed_at_idx" ON "program_overlap_runs"("status", "level", "completed_at");

-- CreateIndex
CREATE INDEX "program_overlap_pairs_program_a_id_idx" ON "program_overlap_pairs"("program_a_id");

-- CreateIndex
CREATE INDEX "program_overlap_pairs_program_b_id_idx" ON "program_overlap_pairs"("program_b_id");

-- CreateIndex
CREATE INDEX "program_overlap_pairs_level_overlap_index_idx" ON "program_overlap_pairs"("level", "overlap_index");

-- CreateIndex
CREATE UNIQUE INDEX "program_overlap_pairs_run_id_program_a_id_program_b_id_key" ON "program_overlap_pairs"("run_id", "program_a_id", "program_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_overlap_recommendations_pair_id_key" ON "program_overlap_recommendations"("pair_id");

-- AddForeignKey
ALTER TABLE "program_learning_outcomes" ADD CONSTRAINT "program_learning_outcomes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_market_profiles" ADD CONSTRAINT "program_market_profiles_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_overlap_pairs" ADD CONSTRAINT "program_overlap_pairs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "program_overlap_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_overlap_pairs" ADD CONSTRAINT "program_overlap_pairs_program_a_id_fkey" FOREIGN KEY ("program_a_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_overlap_pairs" ADD CONSTRAINT "program_overlap_pairs_program_b_id_fkey" FOREIGN KEY ("program_b_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_overlap_recommendations" ADD CONSTRAINT "program_overlap_recommendations_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "program_overlap_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
