-- AlterTable ai_inferences
ALTER TABLE "ai_inferences" ADD COLUMN "kind" TEXT;
ALTER TABLE "ai_inferences" ADD COLUMN "cost_estimate_usd" DOUBLE PRECISION;
CREATE INDEX "ai_inferences_kind_idx" ON "ai_inferences"("kind");

-- CreateTable ai_extractions
CREATE TABLE "ai_extractions" (
    "id" TEXT NOT NULL,
    "source_entity_type" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "extraction_kind" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method_version" TEXT NOT NULL,
    "ai_inference_id" TEXT,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "reasoning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_extractions_source_entity_type_source_entity_id_idx" ON "ai_extractions"("source_entity_type", "source_entity_id");
CREATE INDEX "ai_extractions_extraction_kind_idx" ON "ai_extractions"("extraction_kind");
CREATE INDEX "ai_extractions_review_status_idx" ON "ai_extractions"("review_status");

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_ai_inference_id_fkey" FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
