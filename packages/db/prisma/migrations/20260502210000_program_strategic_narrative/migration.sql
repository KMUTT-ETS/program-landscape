-- AI-generated strategic narrative — markdown brief per program. Drives
-- the Deep-Dive's "Strategic narrative" section (replaces the on-demand
-- regenerate flow with a pre-computed pipeline output).

CREATE TABLE "program_strategic_narratives" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "content_markdown" TEXT NOT NULL,
    "method_version" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_ai_inference_id" TEXT,

    CONSTRAINT "program_strategic_narratives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_strategic_narratives_program_id_key" ON "program_strategic_narratives"("program_id");

ALTER TABLE "program_strategic_narratives"
  ADD CONSTRAINT "program_strategic_narratives_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
