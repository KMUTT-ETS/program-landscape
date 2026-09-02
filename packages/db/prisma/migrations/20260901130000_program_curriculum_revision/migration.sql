-- CreateTable
CREATE TABLE "program_curriculum_revisions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "input_stats_json" JSONB NOT NULL,
    "method_version" TEXT NOT NULL,
    "ai_inference_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_curriculum_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_curriculum_revisions_program_id_generated_at_idx" ON "program_curriculum_revisions"("program_id", "generated_at");

-- AddForeignKey
ALTER TABLE "program_curriculum_revisions" ADD CONSTRAINT "program_curriculum_revisions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
