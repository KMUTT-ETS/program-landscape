-- Local cache of kkuscholar publication queries. The mirror is on KKU's
-- internal network and the profile-page query is ~3-8s per cold load.
-- This cache lets subsequent loads serve from local Postgres in ~50ms;
-- background revalidation keeps it fresh.

CREATE TABLE "user_publications_cache" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "paper_count" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_publications_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_publications_cache_user_id_key"
  ON "user_publications_cache"("user_id");

ALTER TABLE "user_publications_cache"
  ADD CONSTRAINT "user_publications_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
