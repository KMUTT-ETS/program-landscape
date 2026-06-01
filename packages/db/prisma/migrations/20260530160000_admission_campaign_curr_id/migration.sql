-- ADMISSION_STAT gained CURR_ID (+ ENROLLSEAT / PLAN_PER_YEAER) — store the
-- curriculum code for authoritative program resolution. Additive.

-- AlterTable
ALTER TABLE "admission_campaign_stats" ADD COLUMN "curr_id" TEXT;

-- CreateIndex
CREATE INDEX "admission_campaign_stats_curr_id_idx" ON "admission_campaign_stats"("curr_id");
