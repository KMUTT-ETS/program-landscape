-- AlterTable annotations
ALTER TABLE "annotations" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE "annotations" ADD COLUMN "section_key" TEXT;
ALTER TABLE "annotations" ADD COLUMN "ai_inference_id" TEXT;

-- CreateIndex
CREATE INDEX "annotations_kind_idx" ON "annotations"("kind");

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_ai_inference_id_fkey" FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
