-- AI-drafted AUN-QA self-assessment paragraph, one row per
-- (programme × criterion × prompt version). A version bump SHADOWS old
-- drafts rather than overwriting them — the same pattern
-- program_pedagogy_assessments and user_expertise_narratives use — so a
-- draft can always be traced back to the prompt that produced it.
--
-- HAND-CURATED. `prisma migrate diff` in this repo emits unrelated drift
-- (DROP TABLE mv_refresh_log, verdict_snapshots column rewrites, assorted
-- index/constraint renames). Only this feature's own statements are here,
-- copied byte-for-byte from the generated diff. See the
-- `feedback_prisma_migrate_diff_drift` memory and
-- migrations/20260825120000_student_dq_cubes for the worked example.

-- CreateTable
CREATE TABLE "aunqa_criterion_narratives" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "criterion_id" TEXT NOT NULL,
    "method_version" TEXT NOT NULL,
    "paragraph" TEXT NOT NULL,
    "gaps_json" JSONB NOT NULL,
    "band" TEXT NOT NULL,
    "sub_criteria_total" INTEGER NOT NULL,
    "sub_criteria_with_evidence" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "ai_inference_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aunqa_criterion_narratives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aunqa_criterion_narratives_program_id_idx" ON "aunqa_criterion_narratives"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "aunqa_criterion_narratives_program_id_criterion_id_method_v_key" ON "aunqa_criterion_narratives"("program_id", "criterion_id", "method_version");

-- AddForeignKey
ALTER TABLE "aunqa_criterion_narratives" ADD CONSTRAINT "aunqa_criterion_narratives_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
