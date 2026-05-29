-- CiteScore Top-10% tier flag on research outputs. True when the
-- journal is in the Top-10% of titles in ANY of its subject areas for
-- the chosen year (≡ max CiteScore percentile ≥ 90) — the finer "Tier 1"
-- band inside Q1. Additive + nullable; populated by the kku-research
-- connector alongside quartile. The connector run that follows also
-- corrects cite_score_percentile to the journal MAX (was the
-- best-quartile subject-area row).
ALTER TABLE "research_outputs" ADD COLUMN "top_10_percent" BOOLEAN;
