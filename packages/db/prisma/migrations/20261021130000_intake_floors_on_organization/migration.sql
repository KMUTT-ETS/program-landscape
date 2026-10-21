-- Minimum viable intake becomes institution policy instead of a constant.
--
-- `KKU_INTAKE_FLOOR_BACHELOR = 30` and `KKU_INTAKE_FLOOR_POSTGRAD = 8` were
-- written in health-score.ts and copied into risk-scoring.ts. They decide
-- whether a programme counts as viable, and below the bachelor floor a
-- programme is closure-track — a decision a university council makes, not
-- one this software should hold. An adopting institution could change them
-- only by editing two files that were free to drift apart.
--
-- The defaults are those same values, so every existing installation scores
-- exactly as it did before: the single profile row that already exists is
-- backfilled with 30 and 8 by the DEFAULT clause.
ALTER TABLE "organization_profile"
  ADD COLUMN "intake_floor_bachelor" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "intake_floor_postgrad" INTEGER NOT NULL DEFAULT 8;
