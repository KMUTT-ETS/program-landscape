-- Denormalize the resolved canonical program onto admission_campaign_stats so
-- scoring / deep-dive / risk read it directly (drop-in for the retiring
-- tcas_admission_funnels.program_id). Resolved at ingest. Additive.

-- AlterTable
ALTER TABLE "admission_campaign_stats" ADD COLUMN "program_id" TEXT;

-- CreateIndex
CREATE INDEX "admission_campaign_stats_program_id_idx" ON "admission_campaign_stats"("program_id");

-- AddForeignKey
ALTER TABLE "admission_campaign_stats" ADD CONSTRAINT "admission_campaign_stats_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
