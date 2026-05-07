-- Add PubMed ID column on research_outputs.
-- Populated by the kku-research connector once it pivots from OpenAlex
-- to the internal kku-publications mirror, which carries PubMed papers
-- alongside Scopus.

ALTER TABLE "research_outputs" ADD COLUMN "pmid" TEXT;

CREATE INDEX "research_outputs_pmid_idx" ON "research_outputs"("pmid");
