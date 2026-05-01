-- Program metadata + recruitment-summary columns. Driven by:
--   1. KKU master programs sheet — `รหัสหลักสูตร อว.` (mhesi_code) +
--      `ลำดับหลักสูตร` (sequence_no_from_sheet).
--   2. AI program-digest.v1 — recruitment_summary_th / _en.

-- AlterTable
ALTER TABLE "programs"
  ADD COLUMN "mhesi_code" TEXT,
  ADD COLUMN "sequence_no_from_sheet" INTEGER,
  ADD COLUMN "recruitment_summary_th" TEXT,
  ADD COLUMN "recruitment_summary_en" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "programs_mhesi_code_key" ON "programs"("mhesi_code");
