-- AlterTable: which curriculum revision an extraction was taken from.
-- Nullable with NO backfill, deliberately. Existing rows stay NULL, and an
-- unrevised programme resolves its run revision to NULL too, so `NULL = NULL`
-- matches and the phase-1 guards keep skipping at $0. Backfilling to anything
-- else — or treating "missing" as "stale" — would regenerate 332 digests,
-- 283 faculty lists and 309 skill extractions on the next --all run.
ALTER TABLE "ai_extractions" ADD COLUMN "program_revision_id" TEXT;

-- CreateIndex: the guard's lookup is
-- (source_entity_type, source_entity_id, extraction_kind, program_revision_id).
CREATE INDEX "ai_extractions_source_entity_type_source_entity_id_extracti_idx"
  ON "ai_extractions"("source_entity_type", "source_entity_id", "extraction_kind", "program_revision_id");

-- AddForeignKey: SET NULL, matching the ten provenance FKs — deleting a
-- revision degrades its extractions to the pre-feature baseline rather than
-- cascading away real audit rows.
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_program_revision_id_fkey"
  FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
