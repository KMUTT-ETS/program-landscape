-- Profession-aware relevance for demand matches (demand-match.v4). Additive only.
--
-- Hand-written; no generated drift copied (see 20260913140000).
--
-- `relevant` stays and is now DERIVED from `fit` (core / supporting) by the
-- runner. Rows written by demand-match.v3 keep fit NULL until re-run: v3 had
-- no fit, and inventing one for them would misstate what was judged.

ALTER TABLE "program_demand_matches"
  ADD COLUMN "fit" TEXT,
  ADD COLUMN "fit_reason" TEXT;
