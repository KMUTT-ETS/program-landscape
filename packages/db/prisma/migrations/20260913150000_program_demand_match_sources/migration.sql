-- Which labour-market source(s) demanded each checked skill. Additive only.
--
-- Hand-written; no generated drift copied (see 20260913140000).
--
-- Until 2026-09-13 every row came from the LinkedIn-via-MHESI feed
-- (data_sources.slug 'kmitl-skill-mapping'), so existing rows are backfilled
-- with that source. JobThai-demanded skills join the same AI check from v5.2;
-- a skill demanded by both carries both slugs. Readers that mean "LinkedIn
-- demand" filter on it, so demand_match_filled does not silently absorb
-- JobThai rows.

ALTER TABLE "program_demand_matches"
  ADD COLUMN "demand_sources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "program_demand_matches"
  SET "demand_sources" = ARRAY['kmitl-skill-mapping']::TEXT[]
  WHERE "demand_sources" = ARRAY[]::TEXT[];

CREATE INDEX "program_demand_matches_demand_sources_idx"
  ON "program_demand_matches" USING GIN ("demand_sources");
