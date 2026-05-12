-- Per-program pedagogical-readiness assessment table.
--
-- Backs `program-pedagogy.v1`: reads the curriculum PDF + program
-- metadata (faculty, level) and scores observed teaching/learning/
-- assessment/QA practices against discipline-specific best practice
-- (medical→PBL+clinical, engineering→project-based+internship, etc.).
--
-- Single source of truth for:
--   - health-score.v3.6 relevance dimension `pedagogical_fit` driver
--   - ai-readiness.v3 `pedagogicalReadiness` sub-score
--
-- One row per program; re-generation upserts on the unique program_id.

CREATE TABLE "program_pedagogy_assessments" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "discipline_fit_score" DOUBLE PRECISION NOT NULL,
    "qa_score" DOUBLE PRECISION NOT NULL,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "payload_json" JSONB NOT NULL,
    "method_version" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_ai_inference_id" TEXT,
    CONSTRAINT "program_pedagogy_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_pedagogy_assessments_program_id_key"
    ON "program_pedagogy_assessments"("program_id");

ALTER TABLE "program_pedagogy_assessments"
    ADD CONSTRAINT "program_pedagogy_assessments_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
