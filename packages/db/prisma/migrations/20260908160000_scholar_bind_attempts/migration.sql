-- Ledger + daily cap for Google Scholar profile BINDING.
--
-- HAND-WRITTEN. `prisma migrate diff --from-schema-datasource
-- --to-schema-datamodel` against this database also emits unrelated
-- pre-existing drift (DROP TABLE "mv_refresh_log", column drops on
-- "verdict_snapshots", assorted DROP INDEX / DROP DEFAULT / RENAME). The diff
-- was generated to a scratch path OUTSIDE the repo and only the statements
-- below — the new enum, the new table, its indexes and its foreign keys —
-- were carried over. See the `feedback_prisma_migrate_diff_drift` note and
-- docs/dev-database-safety.md.
--
-- Purely additive: one new enum, one new table. No existing table is touched,
-- so nothing is rewritten and nothing can be lost.
--
-- Why it is needed: a bind SPENDS MONEY BEFORE IT CAN SUCCEED. Verifying that
-- a Scholar profile belongs to the person it is being attached to means
-- fetching page 1 of that profile (~15 ScrapingBee credits) and reading the
-- name off it, so a bind REFUSED for a name mismatch has already been billed
-- in full. Before this table those credits left no trace anywhere: a bind
-- writes no scholar_fetch_runs row, so the run ledger's credit total could not
-- see them, and an account pasting one wrong profile id after another could
-- drain the plan with the system holding no record of it. This table is both
-- the spend ledger for binding and the input to the per-user daily cap
-- (SCHOLAR_BIND_MAX_PER_DAY). Refusals count toward that cap deliberately —
-- they are exactly the attempts that cost without producing anything.

-- CreateEnum
CREATE TYPE "ScholarBindOutcome" AS ENUM ('BOUND', 'REFUSED', 'FAILED');

-- CreateTable
CREATE TABLE "scholar_bind_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "faculty_member_id" TEXT,
    "url" TEXT NOT NULL,
    "scholar_profile_id" TEXT,
    "outcome" "ScholarBindOutcome" NOT NULL,
    "profile_name" TEXT,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "error_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scholar_bind_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The daily cap reads (user_id, created_at >= now() - 1 day) on every bind.
CREATE INDEX "scholar_bind_attempts_user_id_created_at_idx" ON "scholar_bind_attempts"("user_id", "created_at");

-- CreateIndex
-- Spend-over-time reporting across all users.
CREATE INDEX "scholar_bind_attempts_created_at_idx" ON "scholar_bind_attempts"("created_at");

-- AddForeignKey
ALTER TABLE "scholar_bind_attempts" ADD CONSTRAINT "scholar_bind_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, not Cascade: FacultyMember rows are churned by the backfill scripts
-- (kkupub_* prefix), and losing the spend ledger to a re-import would hand
-- everyone a fresh daily allowance. Same reasoning as scholar_fetch_runs.
ALTER TABLE "scholar_bind_attempts" ADD CONSTRAINT "scholar_bind_attempts_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
