-- Google Scholar on-demand fetch — additive schema.
--
-- HAND-WRITTEN, not the raw output of `prisma migrate diff`. Against this
-- database the generated diff also emits, unrelated to this feature:
--   DROP TABLE "mv_refresh_log"                (live table, unmodelled in schema.prisma)
--   ALTER TABLE "verdict_snapshots" DROP COLUMN "lifecycle_verdict", "risk_tier"
--   5 × DROP INDEX, assorted DROP DEFAULT and RENAME
-- Every statement below was verified byte-for-byte against the corresponding
-- line of that generated output; nothing else from it was carried over.
-- See the `feedback_prisma_migrate_diff_drift` note and docs/dev-database-safety.md.
--
-- Purely additive: no DROP, no column-type change, no NOT NULL added to an
-- existing column. `ADD COLUMN <nullable> <no default>` is metadata-only in
-- PostgreSQL 11+, so the 81k-row research_outputs table is not rewritten; the
-- two indexes on it take a brief lock but complete in well under a second at
-- that size.

-- CreateEnum
CREATE TYPE "ScholarFetchTrigger" AS ENUM ('SELF', 'ADMIN', 'ADMIN_BULK');

-- CreateEnum
CREATE TYPE "ScholarFetchStatus" AS ENUM ('SUCCEEDED', 'PARTIAL', 'FAILED', 'REFUSED');

-- AlterTable
ALTER TABLE "faculty_members" ADD COLUMN     "scholar_bound_at" TIMESTAMP(3),
ADD COLUMN     "scholar_bound_by_id" TEXT,
ADD COLUMN     "scholar_profile_id" TEXT,
ADD COLUMN     "scholar_profile_url" TEXT;

-- AlterTable
ALTER TABLE "research_outputs" ADD COLUMN     "scholar_paper_id" TEXT;

-- CreateTable
CREATE TABLE "scholar_fetch_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "faculty_member_id" TEXT,
    "triggered_by_id" TEXT NOT NULL,
    "trigger" "ScholarFetchTrigger" NOT NULL,
    "status" "ScholarFetchStatus" NOT NULL,
    "search_query" TEXT,
    "papers_found" INTEGER NOT NULL DEFAULT 0,
    "papers_inserted" INTEGER NOT NULL DEFAULT 0,
    "citations_updated" INTEGER NOT NULL DEFAULT 0,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "error_text" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "scholar_fetch_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholar_fetch_archives" (
    "id" TEXT NOT NULL,
    "fetch_run_id" TEXT NOT NULL,
    "raw_payload" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scholar_fetch_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scholar_fetch_runs_user_id_started_at_idx" ON "scholar_fetch_runs"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "scholar_fetch_runs_faculty_member_id_idx" ON "scholar_fetch_runs"("faculty_member_id");

-- CreateIndex
CREATE INDEX "scholar_fetch_runs_status_idx" ON "scholar_fetch_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "scholar_fetch_archives_fetch_run_id_key" ON "scholar_fetch_archives"("fetch_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_scholar_profile_id_key" ON "faculty_members"("scholar_profile_id");

-- CreateIndex
CREATE INDEX "research_outputs_scholar_paper_id_idx" ON "research_outputs"("scholar_paper_id");

-- CreateIndex
-- Postgres treats NULL as distinct in a unique index, so the ~81k existing
-- rows (all with scholar_paper_id NULL) do not collide. Same shape as the
-- existing (openalex_id, faculty_member_id) pair: one row per paper per
-- matched KKU co-author.
CREATE UNIQUE INDEX "research_outputs_scholar_paper_id_faculty_member_id_key" ON "research_outputs"("scholar_paper_id", "faculty_member_id");

-- AddForeignKey
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_scholar_bound_by_id_fkey" FOREIGN KEY ("scholar_bound_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholar_fetch_runs" ADD CONSTRAINT "scholar_fetch_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholar_fetch_runs" ADD CONSTRAINT "scholar_fetch_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholar_fetch_runs" ADD CONSTRAINT "scholar_fetch_runs_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholar_fetch_archives" ADD CONSTRAINT "scholar_fetch_archives_fetch_run_id_fkey" FOREIGN KEY ("fetch_run_id") REFERENCES "scholar_fetch_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
