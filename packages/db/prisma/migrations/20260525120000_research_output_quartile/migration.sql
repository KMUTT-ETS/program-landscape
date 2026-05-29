-- Scopus journal quartile + supporting metrics on research outputs.
-- Sourced from kku-publications `scopus_citescores` (CiteScore-based):
-- best quartile across the journal's ASJC subject areas for the paper's
-- year. Additive + nullable; PubMed rows and journals without a
-- CiteScore record stay NULL.
ALTER TABLE "research_outputs" ADD COLUMN "quartile" INTEGER;
ALTER TABLE "research_outputs" ADD COLUMN "cite_score_percentile" INTEGER;
ALTER TABLE "research_outputs" ADD COLUMN "sjr" DOUBLE PRECISION;

CREATE INDEX "research_outputs_quartile_idx" ON "research_outputs"("quartile");
