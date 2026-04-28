-- ─────────────────────────────────────────────────────────────────────
-- Prompt 14 / kku-research: schema additions for OpenAlex + Scopus
-- author resolution.
--
-- FacultyMember:
--   + orcid, openalex_author_id, scopus_author_id (all unique-when-present)
--     for cross-system author identity.
--
-- ResearchOutput:
--   + openalex_id, source, kku_author_name
--   * faculty_member_id becomes nullable so KKU-affiliated papers
--     whose author can't be resolved still land for analyst triage.
--   + unique (openalex_id, faculty_member_id) — same paper can link
--     once per matched KKU author; unmatched papers land with NULL.
--
-- Additive — existing rows survive (faculty_member_id has no NULLs
-- pre-migration, so DROP NOT NULL is a no-op on the data side).
-- ─────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "faculty_members"
  ADD COLUMN "openalex_author_id" TEXT,
  ADD COLUMN "orcid" TEXT,
  ADD COLUMN "scopus_author_id" TEXT;

-- AlterTable
ALTER TABLE "research_outputs"
  ADD COLUMN "kku_author_name" TEXT,
  ADD COLUMN "openalex_id" TEXT,
  ADD COLUMN "source" TEXT,
  ALTER COLUMN "faculty_member_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_orcid_key" ON "faculty_members"("orcid");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_openalex_author_id_key" ON "faculty_members"("openalex_author_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_scopus_author_id_key" ON "faculty_members"("scopus_author_id");

-- CreateIndex
CREATE INDEX "research_outputs_openalex_id_idx" ON "research_outputs"("openalex_id");

-- CreateIndex
CREATE INDEX "research_outputs_doi_idx" ON "research_outputs"("doi");

-- CreateIndex
CREATE UNIQUE INDEX "research_outputs_openalex_id_faculty_member_id_key" ON "research_outputs"("openalex_id", "faculty_member_id");
