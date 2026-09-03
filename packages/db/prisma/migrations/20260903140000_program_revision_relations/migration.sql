-- Make the revision links real Prisma relations.
--
-- The ten provenance FKs (`<table>_program_revision_id_fkey`) were already
-- created by migration 20260903130000 with exactly Prisma's own naming and
-- default shape (ON DELETE SET NULL ON UPDATE CASCADE), so declaring their
-- relation fields needs no DDL — this migration only closes the gap on
-- `programs.active_revision_id`, which had no constraint of any kind.

-- CreateIndex
-- @unique: a revision belongs to exactly one programme, so it can never
-- legitimately be the active revision of two. Safe to apply — the column is
-- NULL on every row (nothing writes it yet).
CREATE UNIQUE INDEX "programs_active_revision_id_key" ON "programs"("active_revision_id");

-- AddForeignKey
-- SET NULL: deleting a revision degrades the programme to the pre-feature
-- baseline rather than cascading away the programme itself.
ALTER TABLE "programs" ADD CONSTRAINT "programs_active_revision_id_fkey" FOREIGN KEY ("active_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
