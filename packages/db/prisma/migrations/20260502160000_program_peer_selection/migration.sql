-- AI-driven peer comparison: curated QS/THE-ranked university universe +
-- per-program AI-picked peer selections across 4 geographic tiers.

CREATE TYPE "PeerTier" AS ENUM ('WORLD', 'ASIA', 'SOUTHEAST_ASIA', 'THAILAND_PEER');

CREATE TABLE "ranked_universities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "qs_world_rank" INTEGER,
    "the_world_rank" INTEGER,
    "qs_asia_rank" INTEGER,
    "the_asia_rank" INTEGER,
    "subject_ranks_json" JSONB,
    "ranking_year" INTEGER NOT NULL,
    "website_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranked_universities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ranked_universities_name_ranking_year_key"
  ON "ranked_universities"("name", "ranking_year");
CREATE INDEX "ranked_universities_region_idx" ON "ranked_universities"("region");
CREATE INDEX "ranked_universities_qs_world_rank_idx" ON "ranked_universities"("qs_world_rank");
CREATE INDEX "ranked_universities_the_world_rank_idx" ON "ranked_universities"("the_world_rank");

CREATE TABLE "program_peer_selections" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "tier" "PeerTier" NOT NULL,
    "ranked_university_id" TEXT NOT NULL,
    "peer_program_name" TEXT NOT NULL,
    "peer_program_url" TEXT,
    "rationale" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "subject_area" TEXT,
    "rank_in_tier" INTEGER NOT NULL,
    "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selected_by_ai_inference_id" TEXT,

    CONSTRAINT "program_peer_selections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_peer_selections_program_id_tier_ranked_university_id_key"
  ON "program_peer_selections"("program_id", "tier", "ranked_university_id");
CREATE INDEX "program_peer_selections_program_id_tier_idx"
  ON "program_peer_selections"("program_id", "tier");

ALTER TABLE "program_peer_selections"
  ADD CONSTRAINT "program_peer_selections_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_peer_selections"
  ADD CONSTRAINT "program_peer_selections_ranked_university_id_fkey"
  FOREIGN KEY ("ranked_university_id") REFERENCES "ranked_universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
