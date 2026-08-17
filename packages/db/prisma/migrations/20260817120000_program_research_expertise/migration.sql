-- Demonstrated research-expertise brief per program, derived from the
-- program's curated faculty roster's last-10-years publications. Unlike
-- program_strategic_narratives / program_ai_readiness_assessments, this
-- table is INSERT-only (never upserted) — every generation run adds a new
-- row so history is preserved; readers take the latest by generated_at.
CREATE TABLE "program_research_expertise" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "input_stats_json" JSONB NOT NULL,
    "method_version" TEXT NOT NULL,
    "ai_inference_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_research_expertise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_research_expertise_program_id_generated_at_idx" ON "program_research_expertise"("program_id", "generated_at");

-- AddForeignKey
ALTER TABLE "program_research_expertise" ADD CONSTRAINT "program_research_expertise_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
