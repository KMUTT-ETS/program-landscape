-- HAND-WRITTEN. Additive only: a new cache table keyed by staff record.
-- user_publications_cache is left in place (no reader) and dropped later.

-- CreateTable
CREATE TABLE "staff_publications_cache" (
    "id" TEXT NOT NULL,
    "faculty_member_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "paper_count" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_publications_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_publications_cache_faculty_member_id_key" ON "staff_publications_cache"("faculty_member_id");

-- AddForeignKey
ALTER TABLE "staff_publications_cache" ADD CONSTRAINT "staff_publications_cache_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
