-- Migration: 20260511180000_ai_extraction_gold_label
--
-- Closes evaluation-pipeline.md §13 gap #3 (AI extraction accuracy unmeasured).
-- Adds hand-label storage on AiExtraction so the eval runner can compute
-- precision/recall/F1 against a hand-curated gold set per prompt version.
--
-- Pure additive. No data destruction.
--
-- Lifecycle of a row:
--   1. is_gold_sample flipped true by `pnpm ai:gold-pick` — marks the
--      extraction as a candidate.
--   2. gold_label (Json) filled by the analyst via `pnpm ai:gold-label`
--      with the correct payload shape (mirrors payload_json).
--   3. gold_labelled_at + gold_labelled_by_user_id stamped at write time.
--   4. `pnpm ai:eval-accuracy` reads (payload_json, gold_label) pairs
--      and reports per-prompt + per-threshold F1.
--
-- Resampling: re-running `ai:gold-pick` can flip new candidates without
-- disturbing existing labelled rows (idempotent — only marks rows where
-- is_gold_sample = false).

ALTER TABLE "ai_extractions"
  ADD COLUMN "is_gold_sample"         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN "gold_label"             JSONB,
  ADD COLUMN "gold_labelled_at"       TIMESTAMP(3),
  ADD COLUMN "gold_labelled_by_user_id" TEXT;

ALTER TABLE "ai_extractions"
  ADD CONSTRAINT "ai_extractions_gold_labelled_by_fkey"
  FOREIGN KEY ("gold_labelled_by_user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_extractions_is_gold_sample_idx"
  ON "ai_extractions" ("is_gold_sample") WHERE "is_gold_sample" = true;
