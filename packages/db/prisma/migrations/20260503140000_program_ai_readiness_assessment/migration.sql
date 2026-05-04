-- CreateTable
CREATE TABLE "program_ai_readiness_assessments" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "relevance_score" DOUBLE PRECISION NOT NULL,
    "payload_json" JSONB NOT NULL,
    "method_version" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_ai_inference_id" TEXT,

    CONSTRAINT "program_ai_readiness_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "program_ai_readiness_assessments_program_id_key" ON "program_ai_readiness_assessments"("program_id");

-- AddForeignKey
ALTER TABLE "program_ai_readiness_assessments" ADD CONSTRAINT "program_ai_readiness_assessments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
